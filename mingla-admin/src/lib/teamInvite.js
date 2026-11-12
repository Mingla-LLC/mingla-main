/**
 * #3988 — send a Mingla Admin team invite from Community & Support.
 *
 * Same server path as Admin → Team: the owner-only `admin-team-invite` Edge
 * Function issues the one-time link and sends the email. Nothing here writes a
 * membership or staff table.
 *
 * Pure module: the caller passes its edge-function invoker (invokeWithRefresh),
 * so the Deno suite can exercise it without a Supabase client.
 */

export const TEAM_INVITE_FUNCTION = "admin-team-invite";

export const TEAM_INVITE_ROLE_OPTIONS = Object.freeze([
  Object.freeze({ id: "growth", label: "Sales and marketing" }),
  Object.freeze({ id: "admin", label: "Admin" }),
  Object.freeze({ id: "partner", label: "Founding partner" }),
]);

export const TEAM_INVITE_HELP =
  "They'll get an email to join Mingla Admin. Once they've signed in, set their Community & Support role here.";
export const TEAM_INVITE_OWNER_ONLY = "Only the Owner can invite new teammates.";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INVITE_ERRORS = Object.freeze({
  forbidden: "Only the Owner can invite new teammates.",
  invalid_email: "That doesn't look like an email address.",
  already_active: "They already have access. Set their role on their row instead.",
  team_membership_conflict: "They already have access under another role. Reload and try again.",
  address_in_use: "That address can't be used for team access.",
});

export function isInviteEmail(email) {
  return EMAIL_PATTERN.test(String(email || "").trim().toLowerCase());
}

/** Plain-English text for a refused or failed invite. */
export function teamInviteErrorMessage(result) {
  if (result?.outcome === "session") return "Sign in again";
  if (result?.outcome === "refused") {
    const code = typeof result.code === "string" ? result.code.split(/[:\s]/)[0] : "";
    return INVITE_ERRORS[code] || "Couldn't send the invite. Try again.";
  }
  return "Couldn't send the invite. Check your connection and try again.";
}

/** #4400: shown when the server no longer accepts this sign-in (HTTP 401). */
export const SESSION_ENDED_MESSAGE = "Your sign-in ended. Sign in again.";

/** #4400: a non-2xx answer with no readable reason. */
export const INVITE_FAILED_MESSAGE = "Couldn't send the invite. Something went wrong. Try again.";

async function readErrorCode(error) {
  const ctx = error?.context;
  if (!ctx || typeof ctx.text !== "function") return "";
  try {
    // Text first, then parse: a Response body can be read only once.
    const raw = await ctx.text();
    const body = JSON.parse(raw);
    return typeof body?.code === "string" ? body.code : "";
  } catch {
    return "";
  }
}

/**
 * #4400 — the one reading of an admin-team-invite answer, shared by Admin →
 * Team and Community & Support. Pass the { data, error } the invoker returned,
 * or { thrown: true } when the call threw. Returns { outcome, code? }:
 *   "session"     — HTTP 401 or code not_authenticated (sign in again)
 *   "unreachable" — the request never reached the server (FunctionsFetchError, a throw)
 *   "refused"     — the server said no, with its code
 *   "failed"      — a non-2xx with no readable code (FunctionsRelayError included)
 *   "sent" / "not_sent" — invited; the email went, or did not
 * Never throws.
 */
export async function readTeamInviteResult({ data, error, thrown } = {}) {
  if (thrown) return { outcome: "unreachable" };
  if (error) {
    if (error.name === "FunctionsFetchError") return { outcome: "unreachable" };
    const status = error?.context?.status ?? error?.status;
    const code = await readErrorCode(error);
    if (status === 401 || code === "not_authenticated") return { outcome: "session" };
    if (code) return { outcome: "refused", code };
    return { outcome: "failed" };
  }
  if (!data || typeof data !== "object") return { outcome: "failed" };
  if (!data.ok) {
    if (data.code === "not_authenticated") return { outcome: "session" };
    return { outcome: "refused", code: data.code };
  }
  return { outcome: data.email_sent ? "sent" : "not_sent", data };
}

/**
 * Returns { outcome }: "sent" | "not_sent" (invited, email failed) |
 * "refused" (with the server code) | "session" | "unreachable" | "failed".
 * Never throws.
 */
export async function sendTeamInvite(invoke, { email, role }) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!isInviteEmail(normalized)) return { outcome: "refused", code: "invalid_email" };
  if (!TEAM_INVITE_ROLE_OPTIONS.some((option) => option.id === role)) {
    return { outcome: "refused", code: "invalid_role" };
  }
  let answer;
  try {
    answer = await invoke(TEAM_INVITE_FUNCTION, {
      body: { email: normalized, role },
    });
  } catch {
    return { outcome: "unreachable" };
  }
  const result = await readTeamInviteResult(answer || {});
  if (result.outcome === "sent" || result.outcome === "not_sent") {
    return { outcome: result.outcome, email: normalized };
  }
  return result;
}
