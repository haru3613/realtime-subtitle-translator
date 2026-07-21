export interface Cue {
  text: string;
  start: number;
  end: number;
}

function endsSentence(text: string): boolean {
  return /[.?!。？！]\s*$/.test(text);
}

export function chunkCues(
  cues: Cue[],
  opts: { maxChunkSeconds?: number } = {},
): Cue[] {
  const maxChunkSeconds = opts.maxChunkSeconds ?? 8;
  const chunks: Cue[] = [];
  let pending: Cue[] = [];

  const flush = () => {
    if (pending.length === 0) return;
    const first = pending[0];
    const last = pending[pending.length - 1];
    chunks.push({
      text: pending.map((cue) => cue.text).join(" "),
      start: first.start,
      end: last.end,
    });
    pending = [];
  };

  for (const cue of cues) {
    pending.push(cue);

    const first = pending[0];
    const duration = cue.end - first.start;
    if (duration >= maxChunkSeconds || endsSentence(cue.text)) flush();
  }

  flush();
  return chunks;
}

export function recentContext<T>(history: T[], n = 3): T[] {
  if (n <= 0) return [];
  return history.slice(-n);
}
