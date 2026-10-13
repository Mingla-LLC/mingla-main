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

export const ACCEPT_ACTION_KINDS = ["continue", "go_sign_in", "retry", "sign_out", "copy_message"];

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
    body: "{email} already has a Mingla account that signs in another way, so team access can't be added to it. There is nothing to sign in to yet. Ask the person who invited you to send the invite to a different email address.",
    action: { label: "Copy a message to send them", kind: "copy_message" },
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

/**
 * The body for a state with `{email}` filled in. For "account_conflict" it is
 * the invited address (`context.invitedEmail`), or "This address" when the
 * server did not say which; for every other state it is the address someone
 * is signed in with.
 */
export function acceptBody(state, context = {}) {
  const body = acceptCopy(state).body;
  if (state === "account_conflict") {
    return body.replace("{email}", cleanAddress(context.invitedEmail) || "This address");
  }
  return body.replace("{email}", context.email || "another account");
}

/** An address worth showing: plainly an email, short, on one line. */
function cleanAddress(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return /^[^\s@]{1,64}@[^\s@]{1,190}$/.test(text) ? text : "";
}

/**
 * The message an invited person can send to whoever invited them when their
 * address cannot take team access. Plain text, ready to paste.
 */
export function acceptConflictMessage(email) {
  const address = cleanAddress(email);
  return address
    ? `Hi, my Mingla Admin invite to ${address} can't be used because that address already has a Mingla account that signs in another way. Could you send the invite to a different email address of mine? Thanks.`
    : "Hi, my Mingla Admin invite can't be used because the address already has a Mingla account that signs in another way. Could you send the invite to a different email address of mine? Thanks.";
}
