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

/**
 * Returns { outcome }: "sent" | "not_sent" (invited, email failed) |
 * "refused" (with the server code) | "session" | "unreachable". Never throws.
 */
export async function sendTeamInvite(invoke, { email, role }) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!isInviteEmail(normalized)) return { outcome: "refused", code: "invalid_email" };
  if (!TEAM_INVITE_ROLE_OPTIONS.some((option) => option.id === role)) {
    return { outcome: "refused", code: "invalid_role" };
  }
  try {
    const { data, error } = await invoke(TEAM_INVITE_FUNCTION, {
      body: { email: normalized, role },
    });
    const status = error?.context?.status ?? error?.status;
    if (status === 401) return { outcome: "session" };
    if (error || !data) return { outcome: "unreachable" };
    if (!data.ok) return { outcome: "refused", code: data.code };
    return { outcome: data.email_sent ? "sent" : "not_sent", email: normalized };
  } catch {
    return { outcome: "unreachable" };
  }
}
