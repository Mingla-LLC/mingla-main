/**
 * capiTokens.ts — ISSUE-865 / ORCH-1405 · consolidated CAPI-token resolver.
 *
 * The Supabase project sits at the hard 100-secret cap, so the server-side
 * conversion tokens do NOT each get their own secret slot. Instead they live
 * in ONE secret, AD_CONVERSION_TOKENS — a JSON object of
 *   { "<ENV_VAR_NAME>": "<token value>", ... }.
 *
 * resolveCapiToken(name) prefers a standalone env secret (backward-compatible
 * with any token that DOES have its own slot) and falls back to that JSON map,
 * so a lane's stored token-env-var NAME (e.g. "REDDIT_ADS_CAPI_TOKEN",
 * "SNAPCHAT_CAPI_TOKEN") keeps resolving without consuming a slot each. Adding
 * a channel/lane later = one more key in the blob, never a new secret.
 *
 * Fail-open: any parse error yields no token → the sender soft-skips
 * (pending_config); it NEVER throws into the conversion-fire path.
 */

/** Resolve an env-var NAME to its value: standalone secret first, else the AD_CONVERSION_TOKENS blob. */
export function resolveCapiToken(
  name: string,
  getEnv: (n: string) => string | undefined = (n) => Deno.env.get(n),
): string | undefined {
  const direct = getEnv(name);
  if (direct) return direct;
  try {
    const raw = getEnv("AD_CONVERSION_TOKENS");
    if (raw) {
      const map = JSON.parse(raw) as Record<string, unknown>;
      const v = map[name];
      if (typeof v === "string" && v) return v;
    }
  } catch {
    // malformed blob → treat as absence (fail-open)
  }
  return undefined;
}
