/**
 * Translation cache (SPEC §10.1). Framework-agnostic and browser-runnable:
 * no DOM, no `chrome.*`, no network, no Node-only APIs.
 *
 * The cache key is derived from EXACTLY these four fields:
 * `source_text`, `target_lang`, `glossary_profile`, `provider`. Change any one
 * and it's a different entry. In-memory only for v0 — persistence is a later
 * slice.
 */

export interface TranslationKey {
  source_text: string;
  target_lang: string;
  glossary_profile: string;
  provider: string;
}

export class TranslationCache {
  private readonly store = new Map<string, string>();

  /**
   * Composite key. JSON-encoding the ordered tuple keeps it delimiter-safe: a
   * separator character inside one field can't forge another field's boundary
   * (which a naive `join("|")` would allow).
   */
  private keyOf(k: TranslationKey): string {
    return JSON.stringify([
      k.source_text,
      k.target_lang,
      k.glossary_profile,
      k.provider,
    ]);
  }

  get(key: TranslationKey): string | undefined {
    return this.store.get(this.keyOf(key));
  }

  set(key: TranslationKey, translated_text: string): void {
    this.store.set(this.keyOf(key), translated_text);
  }

  clear(): void {
    this.store.clear();
  }
}
