/**
 * Live-CC rolling-window segmentation (SPEC §7.4 latency path).
 *
 * YouTube live CC renders a rolling window of ASR text that extends word by
 * word and slides as lines scroll off. Translating each window snapshot as a
 * standalone "line" retranslates the same words repeatedly and produces
 * mid-sentence fragments (observed as broken 繁中 like 「大聲。」 for a
 * clipped "loud."). This module is the pure fix:
 *
 *   - `mergeRollingWindow` accumulates window snapshots into one transcript
 *     by word-level overlap, so text is appended exactly once.
 *   - `splitSentences` cuts the transcript into completed sentences (each
 *     translated exactly once upstream) and the in-progress tail.
 *
 * Pure logic, no DOM — `liveCaptions.ts` owns the scraping and scheduling.
 */

/** Cap so an hours-long stream cannot grow the transcript unbounded. */
export const TRANSCRIPT_MAX_CHARS = 2000;

const normalize = (text: string): string => text.replace(/\s+/g, " ").trim();

/**
 * Merge the currently visible CC window into the accumulated transcript.
 * Finds the longest suffix of the transcript (word-level) that is a prefix of
 * the window and appends only the remainder; with no overlap the window is
 * treated as a new utterance and appended whole.
 */
export function mergeRollingWindow(transcript: string, window: string): string {
  const win = normalize(window);
  if (win === "") return transcript;
  if (transcript === "") return cap(win);

  const tWords = transcript.split(" ");
  const wWords = win.split(" ");

  const maxLen = Math.min(tWords.length, wWords.length);
  for (let len = maxLen; len > 0; len--) {
    let match = true;
    for (let i = 0; i < len; i++) {
      if (tWords[tWords.length - len + i] !== wWords[i]) {
        match = false;
        break;
      }
    }
    if (match) {
      const rest = wWords.slice(len);
      return cap(rest.length === 0 ? transcript : `${transcript} ${rest.join(" ")}`);
    }
  }
  // No overlap at all: live ASR rewrote a recent word (their→there), which
  // breaks exact matching. Appending would duplicate the whole visible window
  // into the transcript, so restart from the corrected window instead — the
  // only loss is context before the window, which rendering never shows.
  return cap(win);
}

function cap(transcript: string): string {
  if (transcript.length <= TRANSCRIPT_MAX_CHARS) return transcript;
  const overflow = transcript.length - TRANSCRIPT_MAX_CHARS;
  const spaceAfter = transcript.indexOf(" ", overflow);
  return spaceAfter === -1
    ? transcript.slice(overflow)
    : transcript.slice(spaceAfter + 1);
}

export interface SentenceSplit {
  /** Finished sentences (terminator kept), oldest first. */
  complete: string[];
  /** In-progress fragment still being spoken. */
  tail: string;
}

const TERMINATORS = new Set([".", "!", "?", "。", "！", "？", "…"]);
const CLOSERS = new Set(['"', "'", "」", "』"]);

/**
 * True when the terminator at `i` really ends a sentence. Guards the two
 * false-split families that matter for this project's finance/tech domain:
 * decimals ("3.5", "grew 3." awaiting more digits) and single-letter
 * abbreviations ("U.S.", initials).
 * ponytail: multi-letter abbreviations (Mr., Dr., etc.) still split — add an
 * abbreviation list if that ever shows up as garbled subtitles.
 */
function isSentenceEnd(chunk: string, i: number): boolean {
  if (chunk[i] !== ".") return true;
  const prev = chunk[i - 1] ?? "";
  const next = chunk[i + 1] ?? "";
  // Decimal point, or a trailing digit-dot that may still grow ("grew 3.").
  if (/\d/.test(prev) && (next === "" || /\d/.test(next))) return false;
  // Single capital letter before the dot: "U.S.", "J. Smith".
  if (/[A-Z]/.test(prev) && !/[A-Za-z]/.test(chunk[i - 2] ?? "")) return false;
  return true;
}

/** Split one speaker chunk into finished sentences and its remainder. */
function splitChunk(chunk: string): { sentences: string[]; remainder: string } {
  const sentences: string[] = [];
  let start = 0;
  let i = 0;
  while (i < chunk.length) {
    if (!TERMINATORS.has(chunk[i]) || !isSentenceEnd(chunk, i)) {
      i += 1;
      continue;
    }
    // Consume the full terminator run (…, ?!, ...) plus closing quotes.
    let end = i + 1;
    while (end < chunk.length && TERMINATORS.has(chunk[end])) end += 1;
    while (end < chunk.length && CLOSERS.has(chunk[end])) end += 1;
    const sentence = chunk.slice(start, end).trim();
    // Require real content so stray leading punctuation is dropped, not
    // translated as a "sentence".
    if (/[\p{L}\p{N}]/u.test(sentence)) sentences.push(sentence);
    start = end;
    i = end;
  }
  return { sentences, remainder: chunk.slice(start).trim() };
}

/**
 * Split accumulated transcript text into completed sentences and the
 * in-progress tail. A `>>` speaker switch finalizes the fragment before it
 * even without terminal punctuation, and is stripped from the output.
 */
export function splitSentences(text: string): SentenceSplit {
  const chunks = normalize(text)
    .split(/\s*>>\s*/)
    .filter((c) => c !== "");

  const complete: string[] = [];
  let tail = "";

  chunks.forEach((chunk, index) => {
    const { sentences, remainder } = splitChunk(chunk);
    complete.push(...sentences);
    if (index < chunks.length - 1) {
      // Speaker switched — the unterminated fragment is as final as it gets.
      if (remainder !== "") complete.push(remainder);
    } else {
      tail = remainder;
    }
  });

  return { complete, tail };
}
