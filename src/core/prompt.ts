/**
 * Provider-neutral translation prompt assembly (SPEC §7.3).
 *
 * Pure logic: no provider calls, no fetch, no persistence, no UI. Turns the
 * caption context selected upstream (glossary/segmentation) into deterministic
 * `{ system, user }` prompt parts any translation provider can consume.
 */

export interface TranslationPromptInput {
  /** Caption text to translate. */
  currentSource: string;
  /** Target language, e.g. "Traditional Chinese". */
  targetLanguage: string;
  /** Preceding source caption for continuity; omitted when absent/empty. */
  previousSource?: string;
  /** Selected glossary as source→target pairs; omitted when empty. */
  glossary?: Record<string, string>;
}

export interface TranslationPrompt {
  system: string;
  user: string;
}

export function buildTranslationPrompt(
  input: TranslationPromptInput,
): TranslationPrompt {
  const { currentSource, targetLanguage, previousSource, glossary } = input;

  // Explicit "output only" rule — models otherwise echo Previous/Current labels
  // into the subtitle line (seen as 前:/現: in live mode).
  const system = [
    `You translate video subtitles into ${targetLanguage}.`,
    "Keep technical terms accurate (respect the glossary when given).",
    "Reply with ONLY the translated subtitle text for the current line.",
    'Do not explain. Do not quote. Do not prefix with labels like "Previous", "Current", "前", or "現".',
  ].join(" ");

  const sections: string[] = [];

  const glossaryPairs = Object.entries(glossary ?? {});
  if (glossaryPairs.length > 0) {
    const lines = glossaryPairs.map(([src, tgt]) => `${src} → ${tgt}`).join("\n");
    sections.push(`Glossary:\n${lines}`);
  }

  if (previousSource) {
    sections.push(`Context (previous line, do not translate this):\n${previousSource}`);
  }

  sections.push(`Translate this line:\n${currentSource}`);

  return { system, user: sections.join("\n\n") };
}
