/**
 * Optional host permissions for custom BYOK endpoints.
 * Manifest only declares fixed hosts (YouTube + known providers) so the
 * Chrome Web Store does not flag "all sites" access.
 */

/** Derive a Chrome match pattern covering one origin, e.g. https://api.x.com/* */
export function originPatternFromEndpoint(endpoint: string): string | null {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    const loopback = new Set(["localhost", "127.0.0.1", "[::1]"]);
    if (u.protocol === "http:" && !loopback.has(u.hostname)) return null;
    // Chrome match patterns cover all ports and reject explicit port numbers.
    return `${u.protocol}//${u.hostname}/*`;
  } catch {
    return null;
  }
}

type PermissionsApi = {
  contains(perm: { origins?: string[] }): Promise<boolean>;
  request(perm: { origins?: string[] }): Promise<boolean>;
};

function permissionsApi(): PermissionsApi | null {
  const chromeApi = (globalThis as { chrome?: { permissions?: PermissionsApi } })
    .chrome;
  const browserApi = (
    globalThis as { browser?: { permissions?: PermissionsApi } }
  ).browser;
  return chromeApi?.permissions ?? browserApi?.permissions ?? null;
}

/**
 * Ensure we can fetch `endpoint`. Known manifest hosts pass silently;
 * custom hosts prompt the user via optional_host_permissions.
 */
export async function ensureHostPermissionForEndpoint(
  endpoint: string,
): Promise<{ ok: boolean; pattern: string | null; reason?: string }> {
  const pattern = originPatternFromEndpoint(endpoint);
  if (!pattern) {
    return {
      ok: false,
      pattern: null,
      reason: "Endpoint must use HTTPS (plain HTTP is allowed only for localhost).",
    };
  }

  const api = permissionsApi();
  if (!api) {
    // Tests / non-extension: assume OK.
    return { ok: true, pattern };
  }

  try {
    const already = await api.contains({ origins: [pattern] });
    if (already) return { ok: true, pattern };

    const granted = await api.request({ origins: [pattern] });
    if (!granted) {
      return {
        ok: false,
        pattern,
        reason:
          "Host permission denied. Grant access to this API origin, or pick OpenAI / OpenRouter / Groq / Ollama.",
      };
    }
    return { ok: true, pattern };
  } catch (err) {
    return {
      ok: false,
      pattern,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}
