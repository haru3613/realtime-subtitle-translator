/**
 * Translation pipeline orchestrator (SPEC §7 / §10). Pure and
 * framework-agnostic: no DOM, no `chrome.*`, no `fetch` — the network is the
 * caller's job, injected as `transport`. This is the seam the browser shell
 * calls; the test suite drives it with a fake transport.
 *
 * One pipeline == one playback session: it owns a per-session `SessionCache`
 * (rolling context + latency stats) and a content-keyed `TranslationCache`
 * (cross-cue dedup). Composes, per cue:
 *   translationCache (skip LLM on hit) → segmentation.recentContext →
 *   glossary.selectGlossaryForText → prompt.buildTranslationPrompt →
 *   provider.buildOpenAICompatibleRequest → transport →
 *   provider.parseOpenAICompatibleResponse → write-through to both caches.
 */

import { TranslationCache, type TranslationKey } from "./translationCache";
import { recentContext } from "./segmentation";
import { selectGlossaryForText, type GlossaryProfile } from "./glossary";
import { buildTranslationPrompt } from "./prompt";
import {
  buildOpenAICompatibleRequest,
  parseOpenAICompatibleResponse,
  type OpenAICompatibleRequest,
} from "./provider";
import { SessionCache } from "./sessionCache";

/**
 * Injected network seam: shaped request in, raw provider JSON out. Streaming
 * transports report accumulated text through `onDelta`; every transport can
 * receive an AbortSignal.
 */
export interface TransportOptions {
  onDelta?: (accumulated: string) => void;
  signal?: AbortSignal;
}

export type Transport = (
  req: OpenAICompatibleRequest,
  options?: TransportOptions,
) => Promise<unknown>;

export interface TranslationOptions {
  onPartial?: (accumulated: string) => void;
  signal?: AbortSignal;
}

export interface PipelineConfig {
  /** Model id sent in the provider request. */
  model: string;
  /** Human-readable target language for the prompt AND the cache-key
   *  discriminator (e.g. "Traditional Chinese"). */
  targetLanguage: string;
  /** Provider name — cache-key discriminator only (e.g. "openai-compatible"). */
  provider: string;
  /** Glossary profile name — cache-key discriminator only (e.g. "ai_crypto"). */
  glossaryProfile: string;
  /** Glossary entries the per-cue term selection runs against. */
  glossary: GlossaryProfile;
  /** How many prior source cues to fold in as rolling context (default 3). */
  contextSize?: number;
}

export interface TranslationPipeline {
  /**
   * Translate one caption cue; returns the target-language text. `onPartial`
   * requests a streamed response (cache hits resolve without partials).
   */
  translateCue(
    sourceText: string,
    options?: TranslationOptions,
  ): Promise<string>;
  /** Per-session context + latency stats (exposed for a future stats overlay). */
  readonly sessionCache: SessionCache;
}

export function createTranslationPipeline(
  config: PipelineConfig,
  transport: Transport,
): TranslationPipeline {
  const translationCache = new TranslationCache();
  const sessionCache = new SessionCache();
  const contextSize = config.contextSize ?? 3;

  async function translateCue(
    sourceText: string,
    options?: TranslationOptions,
  ): Promise<string> {
    const key: TranslationKey = {
      source_text: sourceText,
      target_lang: config.targetLanguage,
      glossary_profile: config.glossaryProfile,
      provider: config.provider,
    };

    const hit = translationCache.get(key);
    // ponytail: a HIT short-circuits before touching sessionCache, so a cached
    // cue is not added to the rolling context. Fine for v0 dedup; revisit if
    // cross-cue continuity through cached cues ever matters.
    if (hit !== undefined) return hit;

    const context = recentContext(sessionCache.recentSource(), contextSize);
    const previousSource = context.length > 0 ? context[context.length - 1] : undefined;
    const glossary = selectGlossaryForText(config.glossary, sourceText);

    const prompt = buildTranslationPrompt({
      currentSource: sourceText,
      targetLanguage: config.targetLanguage,
      previousSource,
      glossary,
    });

    const request = buildOpenAICompatibleRequest({
      model: config.model,
      system: prompt.system,
      user: prompt.user,
      stream: options?.onPartial !== undefined,
    });

    const startedAt = Date.now();
    const raw = await transport(request, {
      onDelta: options?.onPartial,
      signal: options?.signal,
    });
    const latencyMs = Date.now() - startedAt;

    const { text } = parseOpenAICompatibleResponse(raw);

    translationCache.set(key, text);
    sessionCache.record({ source: sourceText, translated: text, latencyMs });

    return text;
  }

  return { translateCue, sessionCache };
}
