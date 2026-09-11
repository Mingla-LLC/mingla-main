/**
 * #3201 — per-purpose secrets DERIVED from the service-role key.
 *
 * WHY THIS EXISTS. Two functions read a secret that production never had:
 * `BETA_LEAD_IP_SALT` (the abuse throttle on beta signup and careers apply) and
 * `ADMIN_SOURCE_REFUND_CURSOR_HMAC_SECRET` (the admin refund list's page
 * cursor). Both were declared `optional_top_level`, and both were wrong about
 * it: without the salt the throttle silently never ran (production held 2
 * leads, 0 with an `ip_hash`), and without the cursor secret the refund list
 * works on page one and throws `cursor_secret_unavailable` on page two.
 *
 * WHY NOT JUST SET TWO SECRETS. Production sits at the founder-approved
 * 88-name secret target (`supabase/secrets.manifest.json`). A new secret fails
 * the deploy preflight's live-name parity and two strict-grep capacity guards
 * that pin exactly 88 — proven on #3186, where one extra secret blocked every
 * CI edge deploy on `main`.
 *
 * WHY DERIVATION IS SAFE HERE. HMAC-SHA256 keyed by a high-entropy root, with a
 * distinct label per purpose, is standard key derivation: each output is
 * independent of the others, and none reveals the root. What each consumer
 * needs is stability over a short window, not permanence — the throttle counts
 * attempts inside ten minutes, and a cursor lives for one pagination session.
 * Rotating the service-role key therefore only resets throttle windows and
 * invalidates in-flight cursors, both harmless.
 *
 * AN EXPLICIT VALUE STILL WINS. Each caller passes its own literal
 * `Deno.env.get(...)` as the override, so setting the named secret restores the
 * old behaviour exactly — which is what makes `optional_top_level` TRUE for
 * these names for the first time.
 */

/** Registered labels. One per purpose; never reuse a label for a new purpose. */
export const SCOPED_SECRET_LABELS = {
  /** Shared by beta-access-lead-submit and careers-apply, by design (#3201). */
  betaLeadIpSalt: "beta-lead-ip-salt",
  adminSourceRefundCursor: "admin-source-refund-cursor-hmac",
} as const;

/** Below this, a root is not a safe HMAC key — refuse rather than derive. */
export const MIN_ROOT_SECRET_LENGTH = 32;

const DERIVATION_CONTEXT = "mingla:derived-secret:v1:";

export interface ScopedSecretRootEnv {
  get: (name: string) => string | undefined;
}

// A literal read, so the function-secret contract audit can attribute it.
// `SUPABASE_SERVICE_ROLE_KEY` is platform-managed and injected into every
// function; it is not one of the 88 user-managed names.
function defaultRootEnv(): ScopedSecretRootEnv {
  return {
    get(name: string) {
      if (name === "SUPABASE_SERVICE_ROLE_KEY") {
        return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      }
      return undefined;
    },
  };
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/**
 * Derive the secret for `label`. Always 64 lowercase hex characters.
 * Throws `scoped_secret_root_unavailable` when the root is missing or too short
 * to be a safe key; callers decide whether that fails open or closed.
 */
export async function deriveScopedSecret(
  label: string,
  env: ScopedSecretRootEnv = defaultRootEnv(),
): Promise<string> {
  if (!label) throw new Error("scoped_secret_label_required");
  const root = env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim() ?? "";
  if (root.length < MIN_ROOT_SECRET_LENGTH) {
    throw new Error("scoped_secret_root_unavailable");
  }
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(root),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${DERIVATION_CONTEXT}${label}`),
  );
  return toHex(new Uint8Array(mac));
}

/**
 * The explicit value when one is set, otherwise the derived one.
 * Whitespace-only counts as unset, matching how every caller treated it.
 */
export async function resolveScopedSecret(
  explicit: string | undefined,
  label: string,
  env: ScopedSecretRootEnv = defaultRootEnv(),
): Promise<string> {
  const value = explicit?.trim() ?? "";
  if (value.length > 0) return value;
  return await deriveScopedSecret(label, env);
}
