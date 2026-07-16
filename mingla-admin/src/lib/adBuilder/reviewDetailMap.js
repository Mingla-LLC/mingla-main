/**
 * ISSUE-864 WP4 [Campaign Builder] — blueprint §1.9b: rejection reasons
 * surfaced with cause AND fix. Maps the `ads.review_detail` jsonb persisted by
 * admin-ad-campaign-sync (per-platform vocabularies) + delivery statuses into
 * human cause→fix cards. The verbatim platform text is ALWAYS shown alongside
 * our mapping — never instead of it.
 */

/** Delivery states that are NOT rejections (blueprint §1.9b last row). */
const BILLING_STATES = ["PENDING_BILLING_INFO", "BALANCE_EXCEED", "NO_BUDGET"];

function billingCard(platform, status) {
  return {
    severity: "warning",
    title: "Not a rejection — billing",
    body:
      `This isn't a rejection — ${platform} approved the ad but won't run it because billing isn't set up (${status}). Fix billing in the platform's Ads Manager.`,
    action: "Fix billing",
  };
}

/** Meta ad_review_feedback / issues_info → cards. */
function metaCards(detail) {
  const cards = [];
  const global = detail?.ad_review_feedback?.global;
  if (global && typeof global === "object") {
    for (const [key, description] of Object.entries(global)) {
      const text = String(description ?? key);
      if (/personal attribute/i.test(`${key} ${text}`)) {
        cards.push({
          severity: "error",
          title: "Meta rejected this for 'personal attributes'.",
          body:
            `Meta reads second-person plus an implied personal detail as claiming to know something about the viewer. Rewrite it as a statement about the night, not about the reader. Meta's words: "${text}"`,
          action: "Edit copy",
        });
      } else {
        cards.push({
          severity: "error",
          title: `Meta review: ${key}`,
          body: text,
          action: null,
        });
      }
    }
  }
  const issues = Array.isArray(detail?.issues_info) ? detail.issues_info : [];
  for (const issue of issues) {
    cards.push({
      severity: issue?.error_type === "HARD_ERROR" ? "error" : "warning",
      title: issue?.error_summary ?? "Meta issue",
      body: `${issue?.error_message ?? ""}${issue?.level ? ` (level: ${issue.level})` : ""}`,
      action: null,
    });
  }
  return cards;
}

/** Reddit rejection_reason enum → cause→fix cards (verbatim + our fix). */
function redditCards(detail) {
  const cards = [];
  const reasons = [];
  if (typeof detail?.rejection_reason === "string") reasons.push(detail.rejection_reason);
  if (Array.isArray(detail?.rejection_reasons)) reasons.push(...detail.rejection_reasons);
  for (const reason of reasons) {
    if (/^DATING/.test(reason)) {
      cards.push({
        severity: "error",
        title: "Reddit rejected this as a dating ad.",
        body:
          `Mingla isn't a dating app, but the copy reads like one to Reddit's reviewers (${reason}). Try "plan the night" instead of "meet someone".`,
        action: "Edit copy",
      });
    } else if (reason === "CAPITALIZATION") {
      cards.push({
        severity: "error",
        title: "Reddit rejected this for capitalisation.",
        body: "Drop the ALL CAPS.",
        action: "Edit copy",
      });
    } else if (reason === "EXCEEDING_CHARACTERS") {
      cards.push({
        severity: "error",
        title: "Reddit rejected this for length.",
        body:
          "The headline is over Reddit's ~300-character policy limit. The builder now blocks this before create.",
        action: "Edit copy",
      });
    } else if (reason === "BRIDGE_PAGE") {
      cards.push({
        severity: "error",
        title: "Reddit rejected the link as a bridge page.",
        body:
          "A redirecting link reads as a bridge page. Point Reddit at the canonical public event page instead (destination policy v1 already does this — check the campaign's dest_url).",
        action: "Switch to direct link",
      });
    } else if (/^ALCOHOL/.test(reason)) {
      cards.push({
        severity: "error",
        title: "Reddit rejected this under its alcohol rules.",
        body:
          `${reason}: Reddit restricts alcohol-adjacent creative and can require age targeting its API can't express. Lead with the room and the music, not the drinks.`,
        action: "Edit copy",
      });
    } else {
      cards.push({
        severity: "error",
        title: `Reddit: ${reason}`,
        body: "Reddit's reason, verbatim. If it bounced media, Reddit only tells us in plain English — the exact message is above.",
        action: null,
      });
    }
  }
  return cards;
}

/** Google policy_topic_entries → cards (LIMITED/FULLY_LIMITED are the real names). */
function googleCards(detail) {
  const cards = [];
  const entries = Array.isArray(detail?.policy_topic_entries) ? detail.policy_topic_entries : [];
  for (const entry of entries) {
    const topic = String(entry?.topic ?? "policy finding");
    const type = String(entry?.type ?? "");
    const evidences = JSON.stringify(entry?.evidences ?? []);
    if (/destination.?mismatch/i.test(`${topic} ${evidences}`)) {
      cards.push({
        severity: "error",
        title: "Google rejected the destination.",
        body:
          "The shown domain doesn't match where the link lands. Fix: put the real page in the final URL and the tracking link in the tracking template — that's Google's own sanctioned pattern (the engine already does this; check dest_url vs dest_smart_link).",
        action: "Apply fix",
      });
    } else if (/unavailable.?offer|destination.?not.?working/i.test(`${topic} ${evidences}`)) {
      cards.push({
        severity: "error",
        title: "Google says the offer isn't available at the destination.",
        body:
          "The page looks sold out, unpublished or past. The sync job auto-pauses campaigns whose destination goes dark — check the event page.",
        action: "View page",
      });
    } else {
      cards.push({
        severity: type === "PROHIBITED" || type === "FULLY_LIMITED" ? "error" : "warning",
        title: `Google policy: ${topic}${type ? ` (${type})` : ""}`,
        body: "Google's policy finding, verbatim — see the raw detail below.",
        action: null,
      });
    }
  }
  return cards;
}

/** TikTok reject_info[] → verbatim + the quality explanation. */
function tiktokCards(detail) {
  const cards = [];
  const rejectInfo = Array.isArray(detail?.reject_info) ? detail.reject_info : [];
  for (const info of rejectInfo) {
    const verbatim = typeof info === "string" ? info : JSON.stringify(info);
    cards.push({
      severity: "error",
      title: "TikTok rejected this for creative quality.",
      body:
        `Their reason: ${verbatim}. TikTok's own line is: the ad must be legible, high-resolution, contain audio, and be dynamic — static images can't be more than 50% of the video.`,
      action: null,
    });
  }
  return cards;
}

/** Snap review_status_reasons — the only machine-readable signal Snap gives. */
function snapchatCards(detail) {
  const reasons = Array.isArray(detail?.review_status_reasons) ? detail.review_status_reasons : [];
  return reasons.map((reason) => ({
    severity: "error",
    title: "Snapchat rejected this.",
    body: `Their reason, word for word: "${reason}".`,
    action: null,
  }));
}

/**
 * The map. `ad` = { review_detail, review_status, status }; `platform` from
 * the campaign row; `deliveryStatus` = the campaign/ad effective status.
 * Returns [{ severity, title, body, action }].
 */
export function mapReviewDetail({ platform, ad, deliveryStatus }) {
  const cards = [];
  const detail = ad?.review_detail ?? null;

  if (deliveryStatus && BILLING_STATES.includes(deliveryStatus)) {
    cards.push(billingCard(platform, deliveryStatus));
  }

  if (detail) {
    if (platform === "meta") cards.push(...metaCards(detail));
    else if (platform === "reddit") cards.push(...redditCards(detail));
    else if (platform === "google") cards.push(...googleCards(detail));
    else if (platform === "tiktok") cards.push(...tiktokCards(detail));
    else if (platform === "snapchat") cards.push(...snapchatCards(detail));
  }

  return cards;
}

/** Dual-badge helpers (WP1 idiom, reused on the campaign surface). */
export const DELIVERY_BADGE_VARIANTS = {
  ACTIVE: "success",
  PAUSED: "default",
  PENDING_REVIEW: "info",
  PREAPPROVED: "info",
  IN_PROCESS: "info",
  PENDING_BILLING_INFO: "warning",
  WITH_ISSUES: "warning",
  BALANCE_EXCEED: "warning",
  DISAPPROVED: "error",
  REJECTED: "error",
  CAMPAIGN_PAUSED: "default",
  ADSET_PAUSED: "default",
  AD_PAUSED: "default",
};
