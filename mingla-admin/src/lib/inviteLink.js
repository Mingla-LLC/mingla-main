// Issue #3802 — one-time invite links, the parts the admin app needs.
//
// Pure module: no React, no Supabase import.

export const INVITE_ROUTE = "accept-invite";

const INVITE_HASH = /^#\/accept-invite\/([A-Za-z0-9_-]{43})$/;

/** "#/accept-invite/<secret>" -> the secret; anything else -> null. */
export function parseInviteHash(hash) {
  if (typeof hash !== "string") return null;
  const match = hash.match(INVITE_HASH);
  return match ? match[1] : null;
}

const KNOWN_ROW_STATES = ["pending", "opened", "expired"];

/**
 * Where an invited person's link stands.
 *   row    — a row from admin_team_list
 *   states — the rows from admin_team_invite_states
 * Only meaningful when row.status === "invited".
 */
export function inviteRowState(row, states) {
  const found = findInviteState(row, states);
  return found && KNOWN_ROW_STATES.includes(found.state) ? found.state : "none";
}

export function findInviteState(row, states) {
  if (!row || !Array.isArray(states)) return null;
  return states.find((s) => s && s.email === row.email) || null;
}

function shortDate(value) {
  const d = value ? new Date(value) : null;
  if (!d || Number.isNaN(d.getTime())) return "soon";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

/** Badge and one line per link state, shown on every invited person's row. */
export const INVITE_STATE_COPY = {
  pending: {
    badge: "Link sent",
    variant: "info",
    needsNewLink: false,
    line: (_row, state) => `Expires ${shortDate(state?.expires_at)}`,
  },
  opened: {
    badge: "Link opened",
    variant: "info",
    needsNewLink: false,
    line: () => "Setting up — not finished yet",
  },
  expired: {
    badge: "Link expired",
    variant: "warning",
    needsNewLink: true,
    line: () => "Send a new invite so they can get in",
  },
  none: {
    badge: "No active link",
    variant: "warning",
    needsNewLink: true,
    line: () => "Send a new invite so they can get in",
  },
};

export const ACCEPT_ACTION_KINDS = ["continue", "go_sign_in", "retry", "sign_out"];

/**
 * Every state the invite screen can be in. Each one says what happened and
 * offers exactly one next step; none is a dead end. `{email}` in a body is
 * filled in by acceptBody().
 */
export const ACCEPT_COPY = {
  ready: {
    title: "Accept your invite",
    body: "You've been invited to Mingla Admin. Continue to choose your password.",
    action: { label: "Continue", kind: "continue" },
  },
  signed_in_other: {
    title: "You're signed in already",
    body: "You're signed in as {email}. Sign out to accept this invite.",
    action: { label: "Sign out and continue", kind: "sign_out" },
  },
  working: {
    title: "Checking your invite",
    body: "This takes a moment.",
    action: { label: "Continue", kind: "continue" },
  },
  ok: {
    title: "You're in",
    body: "Choose your password to finish.",
    action: { label: "Continue", kind: "continue" },
  },
  used: {
    title: "This link was already used",
    body: "If you already chose a password, sign in with it. If you didn't finish, ask the person who invited you to send a new invite.",
    action: { label: "Go to sign in", kind: "go_sign_in" },
  },
  expired: {
    title: "This invite has expired",
    body: "Invites last 7 days. Ask the person who invited you to send a new one — it takes them a few seconds.",
    action: { label: "Go to sign in", kind: "go_sign_in" },
  },
  invalid: {
    title: "This invite link doesn't work",
    body: "It may have been replaced by a newer invite or withdrawn. Check your inbox for a more recent email from Mingla, or ask the person who invited you to send a new one.",
    action: { label: "Go to sign in", kind: "go_sign_in" },
  },
  account_conflict: {
    title: "This email needs a different invite",
    body: "This address already has a Mingla account that signs in another way, so we can't attach team access to it. Ask the person who invited you to invite a different email address. Your link still works if this is sorted out.",
    action: { label: "Go to sign in", kind: "go_sign_in" },
  },
  try_again: {
    title: "We couldn't open your invite",
    body: "Nothing was used up. Try again in a moment.",
    action: { label: "Try again", kind: "retry" },
  },
  offline: {
    title: "You're offline",
    body: "Check your connection and try again. Your link is still good.",
    action: { label: "Try again", kind: "retry" },
  },
};

/** The copy for a state; a state this app does not know reads as "invalid". */
export function acceptCopy(state) {
  return Object.hasOwn(ACCEPT_COPY, state) ? ACCEPT_COPY[state] : ACCEPT_COPY.invalid;
}

export function acceptBody(state, context = {}) {
  return acceptCopy(state).body.replace("{email}", context.email || "another account");
}
