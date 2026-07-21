/**
 * Caption-language guess (SPEC §7.4 成本控制).
 *
 * Captions that are already Chinese must not be sent to the translation
 * provider — that burns tokens to translate Chinese into Chinese and hides
 * the native CC behind a nonsense overlay. This module is the zero-cost
 * pure check both modes share (live-CC has no language metadata, so text
 * inspection is the only signal that covers everything):
 *
 *   - Han-character ratio over countable letters decides "already Chinese".
 *   - Any kana ⇒ NOT Chinese: Japanese captions are kanji-heavy and would
 *     otherwise false-positive, but Japanese videos SHOULD be translated.
 *
 * Pure string logic — no DOM, no network, no chrome.*.
 */

const KANA_RE = /[\p{Script=Hiragana}\p{Script=Katakana}]/u;
const HAN_RE = /\p{Script=Han}/u;
const LETTER_RE = /\p{L}/u;

/** Below this many letters the sample is too small to call — keep translating. */
const MIN_SAMPLE_LETTERS = 4;
/**
 * Han share of letters at/above which the text counts as Chinese. 0.3 keeps
 * zh captions with embedded English tech terms (≈0.35) while an English
 * sentence quoting a couple of Chinese words (≈0.2) stays below.
 */
const HAN_RATIO_THRESHOLD = 0.3;

/** Live mode stops sampling after this many chars: decided "not Chinese". */
export const LANG_DECIDE_CHARS = 80;

/** True for Chinese language codes of any region (zh, zh-Hant, zh-TW, …). */
export function isChineseLangCode(code: string): boolean {
  return /^zh\b/i.test(code);
}

/** True when sampled caption text is already predominantly Chinese. */
export function isMostlyChinese(text: string): boolean {
  if (KANA_RE.test(text)) return false;
  let letters = 0;
  let han = 0;
  for (const ch of text) {
    if (!LETTER_RE.test(ch)) continue;
    letters += 1;
    if (HAN_RE.test(ch)) han += 1;
  }
  if (letters < MIN_SAMPLE_LETTERS) return false;
  return han / letters >= HAN_RATIO_THRESHOLD;
}
