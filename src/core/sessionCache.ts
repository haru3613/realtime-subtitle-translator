/**
 * Playback session cache (SPEC §10.2). Pure in-memory, bounded retention — no
 * persistence (`chrome.storage`), no `chrome.*`, no network, no DOM.
 *
 * Distinct from translationCache.ts (§10.1, the hash-keyed dedup cache): that
 * one is global and keyed by content; this one holds the *recent context* of a
 * single playback session — the last few source/translated segments (to feed
 * `segmentation.recentContext()`), plus the current glossary profile, provider
 * config, and latency stats (to power a future stats overlay).
 *
 * Generic over the glossary-profile and provider-config value types so it
 * round-trips whatever the caller stores without inventing a schema here.
 */

export interface SessionRecord {
  source: string;
  translated: string;
  latencyMs: number;
}

export interface LatencyStats {
  count: number;
  avgMs: number;
  lastMs: number;
}

export class SessionCache<Profile = string, Config = Record<string, unknown>> {
  private readonly maxRecent: number;
  private sourceRing: string[] = [];
  private translatedRing: string[] = [];
  private latencySum = 0;
  private latencyCount = 0;
  private lastMs = 0;
  private profile: Profile | undefined;
  private config: Config | undefined;

  constructor(opts: { maxRecent?: number } = {}) {
    this.maxRecent = opts.maxRecent ?? 20;
  }

  /** Append to both rings (evicting oldest beyond maxRecent) and fold latency. */
  record({ source, translated, latencyMs }: SessionRecord): void {
    this.pushBounded(this.sourceRing, source);
    this.pushBounded(this.translatedRing, translated);
    this.latencySum += latencyMs;
    this.latencyCount += 1;
    this.lastMs = latencyMs;
  }

  /** Retained source segments, newest-last; last `n` if given (default all). */
  recentSource(n?: number): string[] {
    return this.tail(this.sourceRing, n);
  }

  /** Retained translated segments, newest-last; last `n` if given (default all). */
  recentTranslated(n?: number): string[] {
    return this.tail(this.translatedRing, n);
  }

  latencyStats(): LatencyStats {
    if (this.latencyCount === 0) return { count: 0, avgMs: 0, lastMs: 0 };
    return {
      count: this.latencyCount,
      avgMs: this.latencySum / this.latencyCount,
      lastMs: this.lastMs,
    };
  }

  setGlossaryProfile(p: Profile): void {
    this.profile = p;
  }

  get glossaryProfile(): Profile | undefined {
    return this.profile;
  }

  setProviderConfig(c: Config): void {
    this.config = c;
  }

  get providerConfig(): Config | undefined {
    return this.config;
  }

  /** Clear rings, latency stats, and stored config. */
  reset(): void {
    this.sourceRing = [];
    this.translatedRing = [];
    this.latencySum = 0;
    this.latencyCount = 0;
    this.lastMs = 0;
    this.profile = undefined;
    this.config = undefined;
  }

  private pushBounded(ring: string[], value: string): void {
    ring.push(value);
    // maxRecent <= 0 degenerates to "retain nothing" — shift keeps it empty.
    if (ring.length > this.maxRecent) ring.shift();
  }

  // Copy so callers can't mutate the internal ring. `slice(-0)` returns the
  // whole array, so guard n <= 0 explicitly (mirrors segmentation.recentContext).
  private tail(ring: string[], n?: number): string[] {
    if (n === undefined) return [...ring];
    if (n <= 0) return [];
    return ring.slice(-n);
  }
}
