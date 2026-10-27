// Issue #4130 (Wave 2b) — Subscriptions page words and paging.
//
// Pure: no React, no Supabase. The server (admin_list_subscriptions_v2,
// admin_subscription_overview) says each person's real tier — what they would
// have with Global Plus off — and what they get now.

export const SUBSCRIPTIONS_PAGE_SIZE = 20;

/** A person's name, or "No first name" when the profile has none. */
export function personName(row) {
  const name = typeof row?.display_name === "string" ? row.display_name.trim() : "";
  if (row?.has_first_name === false || name === "") {
    return name === "" ? "No first name" : `No first name (${name})`;
  }
  return name;
}

const REAL_TIER_WORDS = {
  paid: { label: "Paid Mingla+", variant: "brand" },
  admin: { label: "Mingla+ given by an admin", variant: "info" },
  trial: { label: "Mingla+ trial", variant: "info" },
  referral: { label: "Mingla+ from referrals", variant: "info" },
  none: { label: "Free", variant: "default" },
};

/** The real tier in words and a badge colour. */
export function realTierLabel(row) {
  if (row?.real_tier === "free") {
    if (row?.real_source === "admin") return { label: "Free (set by an admin)", variant: "default" };
    return REAL_TIER_WORDS.none;
  }
  return REAL_TIER_WORDS[row?.real_source] ?? { label: "Mingla+", variant: "brand" };
}

/** What they can use right now. */
export function getsNowLabel(row) {
  if (row?.gets_now === "mingla_plus") {
    return row?.gets_now_reason === "global" ? "Mingla+ (Global Plus)" : "Mingla+";
  }
  return "Free";
}

/** Whether there is another page, from the server's total (never from the page length). */
export function hasNextPage(total, page, pageSize = SUBSCRIPTIONS_PAGE_SIZE) {
  const t = Number(total);
  if (!Number.isFinite(t)) return false;
  return (page + 1) * pageSize < t;
}

/** "Showing 21–40 of 150". */
export function pageRangeLabel(total, page, rowsOnPage, pageSize = SUBSCRIPTIONS_PAGE_SIZE) {
  if (!total || rowsOnPage === 0) return `Showing 0 of ${Number(total || 0).toLocaleString("en-US")}`;
  const first = page * pageSize + 1;
  const last = page * pageSize + rowsOnPage;
  return `Showing ${first.toLocaleString("en-US")}–${last.toLocaleString("en-US")} of ${Number(total).toLocaleString("en-US")}`;
}

/**
 * The confirmation for switching Global Plus. Off: everyone whose real tier is
 * free loses Mingla+ straight away. Null counts mean the numbers did not load,
 * and the dialog says so instead of guessing.
 */
export function globalPlusConfirmCopy({ turningOn, realFree, realPlus }) {
  if (turningOn) {
    return {
      title: "Turn on Global Plus?",
      body: "Everyone gets Mingla+ features straight away, whatever they pay.",
      confirmLabel: "Turn on for everyone",
    };
  }
  if (realFree === null || realFree === undefined) {
    return {
      title: "Turn off Global Plus?",
      body: "The counts did not load, so this cannot say how many people lose Mingla+. Load them again before turning it off.",
      confirmLabel: null,
    };
  }
  const n = Number(realFree);
  const keep = Number(realPlus ?? 0);
  const people = (count) => `${count.toLocaleString("en-US")} ${count === 1 ? "person" : "people"}`;
  return {
    title: "Turn off Global Plus?",
    body: `${people(n)} will lose Mingla+ features straight away. The ${people(keep)} with Mingla+ of their own (paid, trial, referral or given by an admin) keep it.`,
    confirmLabel: `Turn off for ${people(n)}`,
  };
}

/** Grant lengths offered in the Give Mingla+ panel. */
export const GRANT_DURATIONS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
  { days: 365, label: "1 year" },
];

/** Server refusals in plain words. */
export function subscriptionErrorMessage(error) {
  const msg = String(error?.message ?? error ?? "");
  if (msg.includes("not_authorized") || msg.includes("Unauthorized")) return "You don't have permission to change subscriptions.";
  if (msg.includes("reason_required")) return "Add a reason. It is saved on the server with your name.";
  if (msg.includes("no_change")) return "Nothing changed: Global Plus was already set that way. Refresh to see the current state.";
  if (msg.includes("global_plus_setting_missing")) return "The Global Plus setting is missing on the server, so nothing changed.";
  if (msg.includes("does not exist")) return "That person's account could not be found.";
  return "Couldn't save. Check your connection and try again.";
}

/**
 * #4130: the staff-and-test toggle. Hidden by default; the label says how
 * many the list left out.
 */
/**
 * #4130: the line under the tiles, so the counts say who they leave out
 * (the same staff/test rule and the same toggle as the list).
 */
export function tilesScopeNote(overview) {
  if (!overview) return "";
  if (overview.show_internal === true) return "Counts include staff and test accounts.";
  const n = Number(overview.internal_hidden);
  if (!Number.isFinite(n) || n <= 0) return "";
  return `Counts leave out ${n.toLocaleString("en-US")} staff and test account${n === 1 ? "" : "s"}, as the list does.`;
}

export function internalToggleLabel(showing, hidden) {
  if (showing) return "Hide staff and test";
  const n = Number(hidden);
  return Number.isFinite(n) && n > 0 ? `Show staff and test (${n})` : "Show staff and test";
}
