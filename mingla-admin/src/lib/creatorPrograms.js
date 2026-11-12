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

// #4402: five board columns. "Asked for more" has its own column (it used to
// sit in Setting up while the needs-a-person filter included it).
export const CREATOR_COLUMNS = [
  { id: "needs_person", label: "Needs a person", why: "A handle to check, or all six steps pass" },
  { id: "setting_up", label: "Setting up", why: "Creator is still finishing steps" },
  { id: "waiting", label: "Waiting on creator", why: "You asked for more" },
  { id: "verified", label: "Verified", why: "Hosts can find and hire them" },
  { id: "stopped", label: "Declined or suspended", why: "Hidden from hosts" },
];

/** Which board column a creator's verification state sits in. */
export function creatorColumnFor(verification) {
  switch (verification) {
    case "review": return "needs_person";
    case "needs_more": return "waiting";
    case "verified": return "verified";
    case "suspended":
    case "declined":
      return "stopped";
    default: return "setting_up"; // incomplete, anything new
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

export const VERIFICATION_TONE = {
  incomplete: "default",
  review: "warning",
  needs_more: "info",
  verified: "success",
  declined: "default",
  suspended: "error",
};

export function verificationWord(value) {
  return VERIFICATION_WORDS[value] ?? sentenceFromKey(value);
}

// Board tabs. The board reads admin_creator_queue('all') once and filters here,
// so every tab shows a count.
export const CREATOR_FILTERS = [
  ...CREATOR_COLUMNS.map(({ id, label }) => ({ id, label })),
  { id: "all", label: "All" },
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

/** "Verify", or what Verify means from a stopped state. */
export function verifyLabel(verification) {
  if (verification === "suspended") return "Lift suspension";
  if (verification === "declined") return "Reconsider and verify";
  return "Verify";
}

/** The toast after Verify: only a verified answer says hosts can see them. */
export function verifyResultMessage(verification) {
  if (verification === "verified") return CREATOR_DECISIONS.verify.done;
  return "Saved, but the creator is not verified yet. Refresh to see what is missing.";
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

// #4402 A4: the six steps in the admin's words (the shared SQL labels are
// written for the creator: "Your profile", "Your rates").
export const STEP_KEYS = ["profile", "rates", "showcase", "socials", "payout", "agreement"];
export const STEP_WORDS = {
  profile: "Profile",
  rates: "Rates",
  showcase: "Showcase video",
  socials: "Verified social account",
  payout: "Payout account",
  agreement: "Creator agreement (18+)",
};
const STEP_SHORT = {
  profile: "profile",
  rates: "rates",
  showcase: "video",
  socials: "social account",
  payout: "payout",
  agreement: "agreement",
  handle_review: "handle review",
};

export function stepWord(key) {
  return STEP_WORDS[key] ?? sentenceFromKey(key);
}

/** "3 of 6 checks done" from the checks array. */
export function checksProgress(checks) {
  const list = Array.isArray(checks) ? checks : [];
  const done = list.filter((c) => c && c.done).length;
  return { done, total: list.length, text: `${done} of ${list.length || 6} done` };
}

/** Keys of the checks that are not done, in step order. */
export function missingSteps(checks) {
  const list = Array.isArray(checks) ? checks : [];
  return list.filter((c) => c && !c.done && c.key).map((c) => c.key);
}

/** "social account, payout, agreement" for a list of step keys. */
export function shortStepList(keys) {
  return (Array.isArray(keys) ? keys : []).map((k) => STEP_SHORT[k] ?? stepWord(k).toLowerCase()).join(", ");
}

/** The reason beside a locked Verify. */
export function verifyLockedLine(verification, missing) {
  const list = Array.isArray(missing) ? missing : [];
  const review = list.includes("handle_review");
  // A handle waiting for review is the reason socials is missing: say it once.
  const keys = list.filter((k) => k !== "handle_review" && !(review && k === "socials"));
  const parts = keys.map((k) => stepWord(k).toLowerCase());
  if (review) parts.push("a social account waiting for your review");
  return `${verifyLabel(verification)} unlocks when all six checks pass. Missing: ${parts.join(", ") || "nothing reported yet"}.`;
}

// #4402 A1: the server's flags are a list of MISSING steps
// (verification_reasons) plus handle_review:<platform>. They are worded as
// what is missing, never as achievements ("Verified handle").
export const MISSING_WORDS = {
  verified_handle: "No verified social account",
  age_18_plus: "Age 18+ not confirmed",
  active_payout: "No payout account",
  processed_showcase: "No showcase video",
  signed_agreement: "Creator agreement not signed",
  active_package: "No rates set",
  package: "No rates set",
};

/** Flags split into what is still missing and what needs a person. */
export function creatorFlagGroups(flags) {
  const missing = [];
  const needsPerson = [];
  for (const flag of Array.isArray(flags) ? flags : []) {
    if (typeof flag !== "string") {
      const line = flagLines([flag])[0];
      if (line) missing.push(line);
      continue;
    }
    if (flag.startsWith("handle_review:")) {
      needsPerson.push(`${platformWord(flag.slice("handle_review:".length))} couldn't be checked automatically`);
    } else {
      missing.push(MISSING_WORDS[flag] ?? FLAG_WORDS[flag] ?? sentenceFromKey(flag));
    }
  }
  return { missing, needsPerson };
}

/** The card's one honest line: a person first, then what is missing. */
export function creatorCardLine(creator) {
  if (!creator) return "";
  if (creator.verification === "verified") return "All six steps pass";
  if (creator.verification === "declined" || creator.verification === "suspended") {
    const reason = creator.declined_reason || creator.review_note || "";
    return reason ? (reason.length > 60 ? `${reason.slice(0, 57)}…` : reason) : verificationWord(creator.verification);
  }
  const groups = creatorFlagGroups(creator.flags);
  if (groups.needsPerson[0]) return groups.needsPerson[0];
  const missing = missingSteps(creator.checks);
  if (missing.length) return `Missing: ${shortStepList(missing)}`;
  if (groups.missing[0]) return groups.missing[0];
  return checksProgress(creator.checks).text;
}

/** Flags come back as strings or objects; always return readable lines. */
export function flagLines(flags) {
  if (!Array.isArray(flags)) return [];
  return flags
    .map((flag) => {
      if (flag == null) return null;
      if (typeof flag === "string") return MISSING_WORDS[flag] ?? FLAG_WORDS[flag] ?? sentenceFromKey(flag);
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

// ── Creator social accounts (#4402) ─────────────────────────────────────────

const PLATFORM_WORDS = { instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", snapchat: "Snapchat", x: "X" };
const PLATFORM_PROFILE_URL = {
  instagram: (h) => `https://www.instagram.com/${encodeURIComponent(h)}/`,
  tiktok: (h) => `https://www.tiktok.com/@${encodeURIComponent(h)}`,
  youtube: (h) => `https://www.youtube.com/@${encodeURIComponent(h)}`,
  snapchat: (h) => `https://www.snapchat.com/add/${encodeURIComponent(h)}`,
  x: (h) => `https://x.com/${encodeURIComponent(h)}`,
};

export function platformWord(platform) {
  return PLATFORM_WORDS[platform] ?? sentenceFromKey(platform);
}

/** The public profile a reviewer opens to see the bio code themselves. */
export function profileUrl(platform, handle) {
  const build = PLATFORM_PROFILE_URL[platform];
  return build && handle ? build(handle) : null;
}

export const FOLLOWER_BANDS = ["lt1k", "1k_10k", "10k_50k", "50k_250k", "250k_1m", "gt1m"];
const BAND_WORDS = {
  lt1k: "Under 1k",
  "1k_10k": "1k–10k",
  "10k_50k": "10k–50k",
  "50k_250k": "50k–250k",
  "250k_1m": "250k–1m",
  gt1m: "Over 1m",
};

export function bandWord(band) {
  return band ? (BAND_WORDS[band] ?? sentenceFromKey(band)) : "Not given";
}

/** The band a follower count falls in (same boundaries as the edge function). */
export function bandForCount(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 0) return null;
  if (n < 1_000) return "lt1k";
  if (n < 10_000) return "1k_10k";
  if (n < 50_000) return "10k_50k";
  if (n < 250_000) return "50k_250k";
  if (n < 1_000_000) return "250k_1m";
  return "gt1m";
}

const REVIEW_REASON_WORDS = {
  provider_unreadable: "couldn't read the profile from our server",
  provider_fetch_blocked: "blocked our check",
  handle_conflict: "this handle is claimed by another creator",
};

/** One state for a handle row: { tone, text }. Words as well as colour. */
export function handleState(handle) {
  if (!handle) return { tone: "default", text: "Not added" };
  const platform = platformWord(handle.platform);
  if (handle.review_required) {
    const why = REVIEW_REASON_WORDS[handle.review_reason] ?? "couldn't be checked automatically";
    return { tone: "warning", text: `Needs a person: ${platform} ${why}` };
  }
  if (handle.last_check_status === "rejected") {
    return { tone: "error", text: `Rejected${handle.rejected_note ? `: ${handle.rejected_note}` : ""}` };
  }
  if (handle.verified_at) {
    return handle.follower_source === "admin"
      ? { tone: "success", text: "Approved by Mingla" }
      : { tone: "success", text: `Confirmed by ${platform}` };
  }
  const expiresAt = handle.verify_expires_at ? new Date(handle.verify_expires_at).getTime() : null;
  if (handle.last_check_status === "expired" || (expiresAt !== null && expiresAt <= Date.now())) {
    return { tone: "default", text: "Bio code expired · creator needs a new code" };
  }
  if (handle.last_check_status === "pending") return { tone: "default", text: "Bio code not found yet" };
  return { tone: "default", text: "Bio code added · not checked yet" };
}

/** Audience: what the creator said and what was checked, and whether they differ. */
export function audienceCompare(handle) {
  const self = handle?.self_reported_band ?? (handle?.follower_source === "self_reported" ? handle?.follower_band : null) ?? null;
  const checked = handle && handle.follower_source !== "self_reported" ? handle.follower_band ?? null : null;
  const source = handle?.follower_source === "admin" ? "Checked by Mingla" : handle?.follower_source === "provider" ? `${platformWord(handle.platform)} shows` : null;
  return {
    selfReported: self,
    checked,
    source,
    count: handle?.provider_follower_count ?? null,
    mismatch: Boolean(self && checked && self !== checked),
  };
}

/** Reject reasons the reviewer picks from; the creator sees the chosen line. */
export const HANDLE_REJECT_REASONS = [
  "Not their account",
  "Code not in the bio",
  "Audience doesn't match what they said",
  "Something else",
];

/** The note sent with a rejection, or an error to show. */
export function handleRejectNote(reason, extra) {
  const r = String(reason ?? "").trim();
  const e = String(extra ?? "").trim();
  if (!r) return { error: "Choose a reason." };
  if (r === "Something else" && !e) return { error: "Say why, in a few words the creator will see." };
  const note = r === "Something else" ? e : e ? `${r}. ${e}` : r;
  if (note.length > 500) return { error: "Keep the note under 500 characters." };
  return { note };
}

// ── Creator history (#4402) ─────────────────────────────────────────────────

const HISTORY_WORDS = {
  verify: "Verified",
  ask_more: "Asked for more",
  decline: "Declined",
  suspend: "Suspended",
  handle_approve: "Approved handle",
  handle_reject: "Rejected handle",
};

export function historyLine(event) {
  if (!event) return "";
  const base = HISTORY_WORDS[event.action] ?? sentenceFromKey(event.action);
  if (event.action === "handle_approve" || event.action === "handle_reject") {
    const band = event.follower_band ? ` · band ${bandWord(event.follower_band)}` : "";
    return `${base} · ${platformWord(event.platform)}${band}`;
  }
  return base;
}

// ── Creator detail helpers (#4402) ──────────────────────────────────────────

const PAYOUT_WORDS = {
  "paystack:verified": "Paystack account verified",
  "stripe:active": "Stripe account active",
  "stripe:onboarding": "Stripe setup started, not finished",
  "stripe:restricted": "Stripe account restricted",
  "paystack:failed": "Paystack account failed to verify",
};

export function payoutWord(payout) {
  if (!payout || !payout.provider) return "No payout account connected";
  return PAYOUT_WORDS[`${payout.provider}:${payout.status}`] ?? `${sentenceFromKey(payout.provider)} · ${sentenceFromKey(payout.status)}`;
}

const LOCAL_SEAT_WORDS = {
  none: "No Mingla Local application",
  applied: "Applied to be a Local",
  invited: "Invited to sign the Local agreement",
  active: "Active Local",
  paused: "Local seat paused",
  ended: "Local seat ended",
};

export function localSeatWord(local) {
  const status = local?.status ?? "none";
  const word = LOCAL_SEAT_WORDS[status] ?? sentenceFromKey(status);
  return local?.city_name && status !== "none" ? `${word} · ${local.city_name}` : word;
}

/** Meter tones for a board card, from the queue row's checks and flags. */
export function cardStepTones(creator) {
  const checks = Array.isArray(creator?.checks) ? creator.checks : [];
  const review = (Array.isArray(creator?.flags) ? creator.flags : []).some((f) => typeof f === "string" && f.startsWith("handle_review:"));
  return STEP_KEYS.map((key) => {
    const check = checks.find((c) => c && c.key === key);
    if (check?.done) return "done";
    if (key === "socials" && review) return "you";
    return "creator";
  });
}

function seconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * The six steps on the record, each with who acts next.
 * tone: done | you (needs a Mingla person) | bad (failed) | creator.
 */
export function creatorStepRows(detail) {
  const checks = Array.isArray(detail?.checks) ? detail.checks : [];
  const done = (key) => Boolean(checks.find((c) => c && c.key === key)?.done);
  const handles = Array.isArray(detail?.handles) ? detail.handles : [];
  const packages = (Array.isArray(detail?.packages) ? detail.packages : []).filter((p) => p.active);
  const job = Array.isArray(detail?.showcase) ? detail.showcase[0] : null;
  const rows = [];

  rows.push(done("profile")
    ? { key: "profile", tone: "done", text: `Saved as ${detail?.display_name ?? "this creator"}` }
    : { key: "profile", tone: "creator", tag: "Creator's turn", text: "Profile not saved yet" });

  rows.push(done("rates")
    ? { key: "rates", tone: "done", text: `${packages.length} active rate${packages.length === 1 ? "" : "s"}${packages[0]?.format_label ? ` · ${packages[0].format_label}` : ""}` }
    : { key: "rates", tone: "creator", tag: "Creator's turn", text: "No active rate yet" });

  if (done("showcase")) {
    const ready = (Array.isArray(detail?.showcase) ? detail.showcase : []).find((m) => m.status === "ready") ?? job;
    const length = seconds(ready?.duration_s);
    const size = ready?.width && ready?.height ? ` · ${ready.width} × ${ready.height}` : "";
    rows.push({ key: "showcase", tone: "done", text: `Processed${length ? ` · ${length} s` : ""}${size}` });
  } else if (job?.status === "processing" || job?.status === "awaiting_upload") {
    rows.push({ key: "showcase", tone: "creator", tag: "Processing", text: "Uploaded and still processing. No action needed." });
  } else if (job?.status === "failed") {
    rows.push({ key: "showcase", tone: "bad", tag: "Creator's turn", text: "Processing failed. The creator needs to upload a new video." });
  } else {
    rows.push({ key: "showcase", tone: "creator", tag: "Creator's turn", text: "No showcase video yet" });
  }

  const confirmed = handles.find((h) => h.verified_at && !h.review_required);
  const review = handles.find((h) => h.review_required);
  const rejected = handles.find((h) => h.last_check_status === "rejected");
  const pending = handles.find((h) => !h.verified_at && !h.review_required && h.last_check_status !== "rejected");
  if (done("socials") && confirmed) {
    rows.push({ key: "socials", tone: "done", text: `${platformWord(confirmed.platform)} @${confirmed.handle} ${confirmed.follower_source === "admin" ? "approved by Mingla" : "confirmed (bio code found)"}` });
  } else if (review) {
    rows.push({ key: "socials", tone: "you", tag: "Needs you", text: `${platformWord(review.platform)} couldn't be checked automatically. Open the profile and approve or reject the handle.` });
  } else if (pending) {
    rows.push({ key: "socials", tone: "you", tag: "You can check", text: `${platformWord(pending.platform)} bio code not found yet. Open the profile and check it yourself.` });
  } else if (rejected) {
    rows.push({ key: "socials", tone: "bad", tag: "Creator's turn", text: `Handle rejected${rejected.rejected_note ? `: ${rejected.rejected_note}` : ""}. Waiting for a new code.` });
  } else {
    rows.push({ key: "socials", tone: "creator", tag: "Creator's turn", text: "No social account added yet" });
  }

  rows.push(done("payout")
    ? { key: "payout", tone: "done", text: payoutWord(detail?.payout) }
    : { key: "payout", tone: "creator", tag: "Creator's turn", text: payoutWord(detail?.payout) });

  if (done("agreement")) {
    const when = detail?.agreement?.signed_at ? ` on ${shortDateTime(detail.agreement.signed_at)}` : "";
    rows.push({ key: "agreement", tone: "done", text: `Signed creator agreement${detail?.agreement?.version ? ` ${detail.agreement.version}` : ""}${when} · 18 or over` });
  } else {
    const signed = detail?.agreement?.signed;
    rows.push({ key: "agreement", tone: "creator", tag: "Creator's turn", text: signed ? "Agreement signed, but 18+ not confirmed" : "Agreement not signed yet" });
  }
  return rows;
}

/** Ask-for-more lines built from what is missing. */
export function askMoreSuggestions(missing, handles) {
  const keys = Array.isArray(missing) ? missing : [];
  const out = [];
  const pendingHandle = (Array.isArray(handles) ? handles : []).find((h) => !h.verified_at);
  if (keys.includes("socials")) {
    out.push(pendingHandle
      ? `Add ${pendingHandle.verify_code} to your ${platformWord(pendingHandle.platform)} bio so we can confirm the account.`
      : "Add a social account in Creator setup so we can confirm it is yours.");
  }
  if (keys.includes("payout")) out.push("Connect a payout account in Creator setup.");
  if (keys.includes("agreement")) out.push("Sign the creator agreement.");
  if (keys.includes("showcase")) out.push("Upload a new showcase video (vertical, under 90 seconds).");
  if (keys.includes("rates")) out.push("Add at least one rate in Creator setup.");
  out.push("Send a showcase video filmed by you, not a repost.");
  return out;
}

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

// ── Gig pay ─────────────────────────────────────────────────────────────────

/** "Up to $300" from a gig's pay_up_to_minor in the gig's currency; "—" when none was stored. */
export function payUpToWord(minor, currency) {
  const n = Number(minor);
  if (minor === null || minor === undefined || !Number.isFinite(n) || n <= 0) return "—";
  const code = String(currency ?? "").trim().toUpperCase();
  const amount = n / minorPerUnit(code);
  if (!/^[A-Z]{3}$/.test(code)) return `Up to ${amount.toLocaleString("en-US")}`;
  try {
    const whole = Number.isInteger(amount);
    return `Up to ${new Intl.NumberFormat("en-US", {
      style: "currency", currency: code, currencyDisplay: "narrowSymbol",
      minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2,
    }).format(amount)}`;
  } catch {
    return `Up to ${money(n, code)}`;
  }
}

// ── Mingla Locals ───────────────────────────────────────────────────────────

export const APPLICATION_STATUS_WORDS = {
  submitted: "New",
  shortlisted: "Shortlisted",
  agreement_pending: "Waiting for signature",
  accepted: "Signed · active",
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
export function checkProgramDraft(draft, committedCount = 0) {
  const errors = {};
  const seats = Number(draft.seats);
  if (!/^\d+$/.test(String(draft.seats).trim()) || seats > 10) errors.seats = "Seats must be a whole number from 0 to 10.";
  else if (seats < committedCount) errors.seats = `Seats can't be fewer than the ${committedCount} active or reserved Local seats.`;
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
  creator_profile_not_found: "This creator no longer exists. Refresh the list.",
  checks_incomplete: "This creator still has steps missing.",
  handle_not_found: "This social account was removed. Refresh the creator.",
  invalid_band: "Choose an audience band from the list.",
  note_too_long: "Keep the note shorter.",
  creator_not_reviewable: "This creator's state changed. Refresh the list.",
  dispute_not_escalated: "This dispute was already settled or withdrawn. Refresh the list.",
  invalid_outcome: "Choose release, partial refund or full refund.",
  invalid_refund_bps: "Enter a refund between 1% and 99%.",
  seats_below_active_locals: "Seats can't be fewer than the active and reserved Local seats.",
  social_check_required: "The social post must pass its check before you approve.",
  local_social_post_not_reviewable: "This social post is no longer ready for review. Refresh the list.",
  local_social_check_incomplete: "Check every social-post requirement before marking it complete.",
  media_unavailable: "This video cannot be played right now. Do not approve the review yet.",
  review_media_unavailable: "A submitted video is unavailable. Do not publish this review yet.",
  local_month_not_reviewable: "This review was already decided. Refresh the list.",
  changes_reasons_or_resubmission_invalid: "Add at least one reason. A review can only be sent back once.",
  local_month_not_voidable: "This pick can't be cancelled anymore.",
  agreement_version_required: "Publish the Local agreement before inviting someone to sign.",
  agreement_version_is_server_owned: "The agreement version is set by the published Local agreement, not by an application review.",
  local_agreement_not_published: "Publish the Local agreement before inviting someone to sign.",
  local_signature_required: "The applicant must sign their agreement before their Local seat becomes active.",
  local_city_seats_full: "This city has no unreserved Local seats.",
  local_city_closed: "Local applications for this city are paused.",
  application_not_reviewable: "This application changed. Refresh the list before deciding it.",
  seats_full: "This city has no free seats.",
  invalid_currency: "Use a three-letter currency code, like USD.",
  invalid_range: "The highest amount can't be below the lowest.",
  invalid_rate: "Enter a monthly rate above 0.",
  media_type_unsupported: "Choose a JPG, PNG, GIF, WebP, HEIC, MP4, MOV, M4V, 3GP or WebM file.",
  media_size_invalid: "Choose a photo or video between 1 byte and 25 MB.",
  media_message_shape_invalid: "That photo or video is missing required file details.",
  media_upload_unavailable: "The upload could not be verified. Choose the file and try again.",
  message_media_unavailable: "That photo or video is no longer available.",
};

/** Any thrown error or {ok:false,error} -> one plain sentence. Never raw server text. */
export function programErrorMessage(cause, fallback = "That didn't work. Try again.") {
  const code = errorCode(cause);
  // #4402: Verify refused on the server names the steps still missing.
  if (code === "checks_incomplete") {
    const missing = cause?.result?.missing ?? cause?.missing;
    const list = Array.isArray(missing) ? shortStepList(missing) : "";
    if (list) return `This creator still has steps missing: ${list}.`;
  }
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
