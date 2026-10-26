// Issue #3872 — the words and number rules for the Programs pages (Creators,
// Gigs, Mingla Locals, Disputes) and the Payees ledger.
//
// Pure module: no React, no Supabase. Every server key that reaches a screen
// goes through one of these maps, so a raw status, band code, provider name or
// minor-unit amount never shows. Unknown keys fall back to a plain sentence
// built from the key, never to the key itself.

import { formatMoneyMinor } from "./moneyFormat.js";

const ZERO_DECIMAL = new Set(["JPY", "KRW", "VND", "UGX", "RWF", "XAF", "XOF"]);

/** "posts_submitted" -> "Posts submitted". Last resort for a key with no word yet. */
export function sentenceFromKey(key) {
  if (key == null) return "";
  const text = String(key).replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
}

// ── Creators ────────────────────────────────────────────────────────────────

export const CREATOR_COLUMNS = [
  { id: "setting_up", label: "Setting up" },
  { id: "needs_person", label: "Needs a person" },
  { id: "verified", label: "Verified" },
  { id: "suspended", label: "Suspended" },
];

/** Which board column a creator's verification state sits in. */
export function creatorColumnFor(verification) {
  switch (verification) {
    case "review": return "needs_person";
    case "verified": return "verified";
    case "suspended": return "suspended";
    case "declined": return "declined";
    default: return "setting_up"; // incomplete, needs_more, anything new
  }
}

export const VERIFICATION_WORDS = {
  incomplete: "Setting up",
  review: "Needs a person",
  needs_more: "Asked for more",
  verified: "Verified",
  declined: "Declined",
  suspended: "Suspended",
};

export function verificationWord(value) {
  return VERIFICATION_WORDS[value] ?? sentenceFromKey(value);
}

// Filter tabs: the value is what admin_creator_queue receives as p_status.
export const CREATOR_FILTERS = [
  { id: "needs_person", label: "Needs a person" },
  { id: "all", label: "All" },
  { id: "verified", label: "Verified" },
  { id: "suspended", label: "Suspended" },
];

export const CREATOR_DECISIONS = {
  verify: { label: "Verify", needsNote: false, noteLabel: "Note (optional)", done: "Creator verified. Hosts can now see them." },
  ask_more: { label: "Ask for more", needsNote: true, noteLabel: "What should they send?", done: "Asked the creator for more." },
  decline: { label: "Decline", needsNote: true, noteLabel: "Reason (the creator sees this)", done: "Creator declined." },
  suspend: { label: "Suspend", needsNote: true, noteLabel: "Reason for suspending", done: "Creator suspended. Hosts can no longer see them." },
};

/** Decisions that make sense from a creator's current state. */
export function decisionsFor(verification) {
  switch (verification) {
    case "verified": return ["suspend"];
    case "suspended": return ["verify"];
    case "declined": return ["verify"];
    default: return ["verify", "ask_more", "decline", "suspend"];
  }
}

/** A blank or whitespace note is missing; returns the trimmed note or null. */
export function decisionNoteError(decision, note) {
  const rule = CREATOR_DECISIONS[decision];
  if (!rule) return "Choose what to do.";
  if (rule.needsNote && !String(note ?? "").trim()) {
    return decision === "ask_more" ? "Say what the creator needs to send." : "Add a reason before you continue.";
  }
  return null;
}

/** "3 of 6 checks done" from the checks array. */
export function checksProgress(checks) {
  const list = Array.isArray(checks) ? checks : [];
  const done = list.filter((c) => c && c.done).length;
  return { done, total: list.length, text: `${done} of ${list.length || 6} done` };
}

/** Flags come back as strings or objects; always return readable lines. */
export function flagLines(flags) {
  if (!Array.isArray(flags)) return [];
  return flags
    .map((flag) => {
      if (flag == null) return null;
      if (typeof flag === "string") return FLAG_WORDS[flag] ?? sentenceFromKey(flag);
      if (typeof flag === "object") {
        const label = flag.label ?? flag.text ?? (flag.key ? FLAG_WORDS[flag.key] ?? sentenceFromKey(flag.key) : null);
        return label ? String(label) : null;
      }
      return null;
    })
    .filter(Boolean);
}

const FLAG_WORDS = {
  handle_conflict: "Handle claimed by someone else",
  audience_screenshot: "Audience screenshot needs a look",
  audience_unverified: "Audience size is self-reported",
  bio_code_missing: "Bio code not found",
  duplicate_account: "May be a second account",
  payout_missing: "Payout not connected",
};

// ── Gigs ────────────────────────────────────────────────────────────────────

export const CONTRACT_STATE_WORDS = {
  offered: "Offer sent",
  accepted: "Planning the shoot",
  shoot_planned: "Planning the shoot",
  script_drafting: "Creator is writing the script",
  script_sent: "Script with the host",
  script_locked: "Creator is filming",
  delivered: "Video with the host",
  fix_requested: "Fix requested",
  approved: "Waiting for posts",
  posting: "Waiting for posts",
  posts_submitted: "Checking posts",
  posts_verified: "Posts verified",
  posts_failed: "Posts couldn't be checked",
  released: "Fee released",
  day30: "30-day check",
  completed: "Done",
  disputed: "In dispute",
  resolved_release: "Settled · fee released",
  resolved_partial: "Settled · part refunded",
  resolved_refund: "Settled · refunded",
  declined: "Declined",
  expired: "Expired",
  cancelled: "Cancelled",
};

export function contractStateWord(state) {
  return CONTRACT_STATE_WORDS[state] ?? sentenceFromKey(state);
}

export function contractStateTone(state) {
  if (["released", "completed", "posts_verified", "resolved_release", "day30"].includes(state)) return "success";
  if (state === "disputed") return "error";
  if (["declined", "expired", "cancelled"].includes(state)) return "default";
  return "warning";
}

const EVENT_WORDS = {
  offer_created: "Offer sent",
  hold_captured: "Hired · fee held",
  shoot_plan_proposed: "Shoot time proposed",
  shoot_plan_confirmed: "Shoot time agreed",
  script_saved: "Script draft saved",
  script_sent: "Script sent to the host",
  script_locked: "Script approved by host",
  delivery_submitted: "Video delivered",
  fix_requested: "Fix requested",
  delivery_approved: "Video approved",
  posts_submitted: "Post links added",
  posts_verified: "Posts checked",
  terms_change_proposed: "Change to terms proposed",
  terms_change_accepted: "Terms changed",
  terms_change_declined: "Change to terms declined",
  dispute_opened: "Dispute opened",
  dispute_offer_made: "Settlement offered",
  dispute_escalated: "Dispute sent to Mingla",
  dispute_decided: "Mingla decided the dispute",
  dispute_release_recorded: "Fee released after dispute",
  refund_recorded: "Refund recorded",
  fee_released: "Fee released",
  released: "Fee released",
};

const ACTOR_WORDS = { host: "Host", creator: "Creator", system: "Mingla", admin: "Mingla team" };

export function gigEventWord(kind) {
  return EVENT_WORDS[kind] ?? sentenceFromKey(kind);
}

export function actorWord(actor) {
  return ACTOR_WORDS[actor] ?? sentenceFromKey(actor);
}

/** "15 Oct 10:02" in the viewer's time zone. */
export function shortDateTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} ${time}`;
}

/** "Oct 2026" for a month date (YYYY-MM-01). */
export function monthWord(value) {
  if (!value) return "";
  const d = new Date(`${String(value).slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** "Tue 20 Oct" for a deadline. */
export function dayWord(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

const DELIVERABLE_WORDS = { video: "video", reel: "Reel", story: "Story", stories: "Stories", post: "post", tiktok: "TikTok" };

/** Terms deliverables (strings or {kind,count,label}) -> "1 video + 4 Stories". */
export function deliverablesSummary(deliverables) {
  if (!Array.isArray(deliverables) || !deliverables.length) return "";
  return deliverables
    .map((d) => {
      if (typeof d === "string") return DELIVERABLE_WORDS[d] ?? sentenceFromKey(d).toLowerCase();
      if (!d || typeof d !== "object") return null;
      if (d.label) return String(d.label);
      const kind = DELIVERABLE_WORDS[d.kind ?? d.type] ?? sentenceFromKey(d.kind ?? d.type ?? "item").toLowerCase();
      return d.count ? `${d.count} ${kind}` : kind;
    })
    .filter(Boolean)
    .join(" + ");
}

export const DISPUTE_REASON_WORDS = {
  technical_fixes_exhausted: "Both fixes used and the video still isn't right",
  post_missed: "Posts weren't made on time",
  posts_failed: "Posts couldn't be checked",
  nontechnical_fix_abuse: "Fix requests went beyond the agreed script",
  timer_safety: "The deal stalled with no answer",
  other: "Something else",
};

export function disputeReasonWord(reason) {
  return DISPUTE_REASON_WORDS[reason] ?? sentenceFromKey(reason);
}

/** Percentage typed by an admin -> basis points for the server; null when invalid. */
export function refundPercentToBps(percent) {
  const text = String(percent ?? "").trim();
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(text)) return null;
  const bps = Math.round(Number(text) * 100);
  return bps >= 1 && bps <= 9999 ? bps : null;
}

// ── Money ───────────────────────────────────────────────────────────────────

export function minorPerUnit(currency) {
  return ZERO_DECIMAL.has(String(currency ?? "").toUpperCase()) ? 1 : 100;
}

/**
 * Whole-currency text typed by an admin ("300", "1,500") -> minor units.
 * Empty -> null. Anything else that is not a whole, non-negative number -> NaN.
 */
export function wholeToMinor(text, currency) {
  const raw = String(text ?? "").replace(/[,\s]/g, "");
  if (raw === "") return null;
  if (!/^\d+$/.test(raw)) return Number.NaN;
  return Number(raw) * minorPerUnit(currency);
}

/** Minor units -> whole-currency text for an input ("30000" USD -> "300"). */
export function minorToWhole(minor, currency) {
  if (minor == null || minor === "") return "";
  const n = Number(minor);
  if (!Number.isFinite(n)) return "";
  return String(Math.round(n / minorPerUnit(currency)));
}

export function money(minor, currency) {
  return formatMoneyMinor(minor, currency);
}

export const PAYOUT_CURRENCIES = ["USD", "NGN", "GBP", "EUR", "CAD"];

// ── Budget ranges (gig_budget_bands) ────────────────────────────────────────

export const BUDGET_BANDS = [
  { id: "b1", label: "Level 1" },
  { id: "b2", label: "Level 2" },
  { id: "b3", label: "Level 3" },
  { id: "b4", label: "Level 4" },
];

export const DEFAULT_BUDGET_CURRENCIES = ["USD", "NGN"];

/**
 * Check one band's typed range. Both empty = "level only" (no range shown).
 * Returns { ok, min_minor, max_minor } or { ok:false, field, error }.
 */
export function validateBudgetBand({ min, max }, currency) {
  const minMinor = wholeToMinor(min, currency);
  const maxMinor = wholeToMinor(max, currency);
  if (Number.isNaN(minMinor)) return { ok: false, field: "min", error: "Use a whole number, like 300." };
  if (Number.isNaN(maxMinor)) return { ok: false, field: "max", error: "Use a whole number, like 800." };
  if (minMinor === null && maxMinor === null) return { ok: true, min_minor: null, max_minor: null };
  if (minMinor === null) return { ok: false, field: "min", error: "Add the lowest amount, or clear both to show the level only." };
  if (maxMinor === null) return { ok: false, field: "max", error: "Add the highest amount, or clear both to show the level only." };
  if (minMinor <= 0) return { ok: false, field: "min", error: "The lowest amount must be more than 0." };
  if (maxMinor < minMinor) return { ok: false, field: "max", error: "The highest amount can't be below the lowest." };
  return { ok: true, min_minor: minMinor, max_minor: maxMinor };
}

/** Rows from gig_budget_bands -> { USD: { b1: {min,max}, ... }, ... } as input text. */
export function budgetGridFromRows(rows, currencies = DEFAULT_BUDGET_CURRENCIES) {
  const grid = {};
  const all = new Set(currencies);
  for (const row of Array.isArray(rows) ? rows : []) if (row?.currency) all.add(String(row.currency).toUpperCase());
  for (const currency of all) {
    grid[currency] = {};
    for (const band of BUDGET_BANDS) grid[currency][band.id] = { min: "", max: "" };
  }
  for (const row of Array.isArray(rows) ? rows : []) {
    const currency = String(row?.currency ?? "").toUpperCase();
    if (!grid[currency] || !grid[currency][row.band]) continue;
    grid[currency][row.band] = { min: minorToWhole(row.min_minor, currency), max: minorToWhole(row.max_minor, currency) };
  }
  return grid;
}

// ── Mingla Locals ───────────────────────────────────────────────────────────

export const APPLICATION_STATUS_WORDS = {
  submitted: "New",
  shortlisted: "Shortlisted",
  accepted: "Seated",
  waitlisted: "Waitlisted",
  rejected: "Not this time",
};

export const SOCIAL_CHECK_WORDS = {
  pending: "Social post not checked yet",
  passed: "Social post checked",
  failed: "Social post check failed",
  unverifiable: "Social post couldn't be checked",
};

export const LOCAL_MONTH_WORDS = {
  picked: "Picked",
  confirmed: "Place confirmed",
  visited: "Visited",
  submitted: "Review sent",
  changes_requested: "Changes requested",
  approved: "Approved",
  published: "Published",
  paid: "Paid",
  missed: "Missed",
  void: "Cancelled",
};

/** The three money words (decision 3): On the way · Ready · Paid. */
export function moneyStateWord(shareStatus) {
  switch (shareStatus) {
    case "paid": return "Paid";
    case "releasable": return "Ready";
    case "reversed": return "Reversed";
    case "held_until_event":
    case "accumulating":
      return "On the way";
    case null:
    case undefined:
    case "":
      return "Not queued yet";
    default:
      return sentenceFromKey(shareStatus);
  }
}

/** Validate a city's typed details. Returns { values } or { errors }. */
export function checkProgramDraft(draft, activeCount = 0) {
  const errors = {};
  const seats = Number(draft.seats);
  if (!/^\d+$/.test(String(draft.seats).trim()) || seats > 10) errors.seats = "Seats must be a whole number from 0 to 10.";
  else if (seats < activeCount) errors.seats = `Seats can't be fewer than the ${activeCount} Locals already seated.`;
  const minor = wholeToMinor(draft.rate, draft.currency);
  if (minor === null || Number.isNaN(minor) || minor <= 0) errors.rate = "Enter a whole monthly amount above 0, like 150.";
  if (!PAYOUT_CURRENCIES.includes(draft.currency)) errors.currency = "Choose a payout currency.";
  if (Object.keys(errors).length) return { errors };
  return { values: { seats, monthlyRateMinor: minor, payoutCurrency: draft.currency } };
}

// ── Payees ledger ───────────────────────────────────────────────────────────

export const PAYEE_KIND_WORDS = { referral: "Referral", gig_fee: "Gig fee", local_month: "Local" };

export function payeeKindWord(kind) {
  return PAYEE_KIND_WORDS[kind] ?? (kind ? sentenceFromKey(kind) : "Referral");
}

const STRIPE_COUNTRY_BY_CURRENCY = { USD: "US", GBP: "UK", EUR: "EU", CAD: "CA", AUD: "AU" };
const PAYSTACK_COUNTRY_BY_CURRENCY = { NGN: "NG", GHS: "GH", KES: "KE", ZAR: "ZA" };

/** "Bank (US)" / "Bank (NG)": the rail as the payee knows it, never a provider name. */
export function railWord(rail, currency) {
  const code = String(currency ?? "").toUpperCase();
  if (rail === "paystack") return `Bank (${PAYSTACK_COUNTRY_BY_CURRENCY[code] ?? "NG"})`;
  if (rail === "stripe") return `Bank (${STRIPE_COUNTRY_BY_CURRENCY[code] ?? "US"})`;
  return rail ? "Bank" : "—";
}

export const PAYEE_STATUS_WORDS = {
  held_until_event: "On the way",
  accumulating: "Below payout floor",
  releasable: "Ready",
  paid: "Paid",
  reversed: "Reversed",
};

export function payeeStatusWord(status) {
  return PAYEE_STATUS_WORDS[status] ?? sentenceFromKey(status || "—");
}

const PAYOUT_STATUS_WORDS = {
  pending: "Sending",
  processing: "Sending",
  in_transit: "Sending",
  paid: "Paid",
  failed: "Failed",
  reversed: "Reversed",
  waiting_for_bank: "Waiting for bank details",
};

export function payoutStatusWord(status) {
  return PAYOUT_STATUS_WORDS[status] ?? sentenceFromKey(status);
}

// ── Errors ──────────────────────────────────────────────────────────────────

const ERROR_WORDS = {
  admin_only: "Only Mingla admins can do this.",
  not_authorized: "Only Mingla admins can do this.",
  permission_denied: "You don't have access to this.",
  admin_only_or_invalid: "That decision isn't allowed here.",
  admin_only_or_reason_required: "Add a reason before you continue.",
  note_required: "Add a note before you continue.",
  reason_required: "Add a reason before you continue.",
  invalid_decision: "That decision isn't allowed for this creator.",
  creator_not_found: "This creator no longer exists. Refresh the list.",
  creator_not_reviewable: "This creator's state changed. Refresh the list.",
  dispute_not_escalated: "This dispute was already settled or withdrawn. Refresh the list.",
  invalid_outcome: "Choose release, partial refund or full refund.",
  invalid_refund_bps: "Enter a refund between 1% and 99%.",
  seats_below_active_locals: "Seats can't be fewer than the Locals already seated.",
  social_check_required: "The social post must pass its check before you approve.",
  local_month_not_reviewable: "This review was already decided. Refresh the list.",
  changes_reasons_or_resubmission_invalid: "Add at least one reason. A review can only be sent back once.",
  local_month_not_voidable: "This pick can't be cancelled anymore.",
  agreement_version_required: "Add the approved agreement version before seating a Local.",
  seats_full: "This city has no free seats.",
  invalid_band: "Choose a level from 1 to 4.",
  invalid_currency: "Use a three-letter currency code, like USD.",
  invalid_range: "The highest amount can't be below the lowest.",
  invalid_rate: "Enter a monthly rate above 0.",
};

/** Any thrown error or {ok:false,error} -> one plain sentence. Never raw server text. */
export function programErrorMessage(cause, fallback = "That didn't work. Try again.") {
  const code = errorCode(cause);
  return (code && ERROR_WORDS[code]) || fallback;
}

export function errorCode(cause) {
  if (!cause) return null;
  if (typeof cause === "string") return cause.trim();
  const candidates = [cause.error, cause.code, cause.message, cause.context?.error];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    for (const match of c.matchAll(/[a-z][a-z0-9]*(?:_[a-z0-9]+)*/g)) {
      if (Object.hasOwn(ERROR_WORDS, match[0])) return match[0];
    }
  }
  return typeof cause.error === "string" ? cause.error : null;
}

/** A function the server doesn't have yet (PostgREST PGRST202 / Postgres 42883). */
export function isMissingFunction(cause) {
  return cause?.code === "PGRST202" || cause?.code === "42883";
}
