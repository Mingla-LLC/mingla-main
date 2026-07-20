/**
 * ISSUE-980 [Campaign Builder clarity] finding #2 — the plain-English
 * translation layer between admin-ad-preflight's raw `detail` strings and
 * StepPreflight.jsx. Root cause (ISSUE-977 Lane B F-2): every `check.detail`
 * was rendered to the operator VERBATIM — proof-tags (`T-P2`, `S-P4`, `G-P1`,
 * `M-P9`), raw platform error codes/enums (`1885183`, `pixel_no_signal`,
 * `BALANCE_EXCEED`), and open GitHub issue numbers (`#865`) straight in the
 * admin UI, with no way for a non-engineer to tell "is this bad?" from
 * "what do I do?"
 *
 * Design (two-tier, so this stays accurate as the edge function's live API
 * error text drifts):
 *  1. PATTERN_RULES — an ordered list of substring matches against the raw
 *     detail, for the specific jargon-laden strings ISSUE-977 Lane B named
 *     verbatim (proof-tags, error codes, issue numbers). First match wins.
 *  2. BASELINE — a friendly meaning keyed on (checkId, status), covering
 *     every P1-P6 (+ B6) reason across all 5 platforms EVEN WHEN the raw
 *     detail is a live API exception message no pattern above recognizes
 *     (e.g. a transient network error) — never fabricates specificity it
 *     doesn't have, but always says what KIND of problem this is and, where
 *     knowable, what to do about it.
 *
 * The raw `detail` is NEVER discarded — `technical` on the returned object
 * carries it verbatim for the "Technical details" disclosure in
 * StepPreflight.jsx (a support affordance, never the primary text).
 */

import { PLATFORM_LABELS } from "./channelPlan.js";

function platformName(platform) {
  return PLATFORM_LABELS[platform] ?? platform;
}

// Ordered — most specific first. Each `test` runs against the raw detail
// string; the first match's `friendly` becomes the primary text.
const PATTERN_RULES = [
  {
    test: (d) => /not_connected|not_provisioned|Token secret unset/.test(d),
    friendly: (_d, p) => `${platformName(p)} isn't connected yet. Connect it from Settings, then recheck.`,
  },
  {
    test: (d) => /1885183|meta_app_not_live/.test(d),
    friendly: () =>
      "Meta hasn't approved this app for live ads yet. Switch it to Live mode in the Meta App Dashboard, then recheck.",
  },
  {
    test: (d) => /pixel_no_signal|Pixel has never fired/.test(d),
    friendly: () =>
      "This pixel hasn't recorded any activity yet, so goals that need it (like 'people who convert') aren't available. Sending people to a page still works — recheck once the pixel starts firing.",
  },
  {
    test: (d) => /BALANCE_EXCEED|Advanced Payment Portfolio/.test(d),
    friendly: (_d, p) =>
      `${platformName(p)}'s API can't see funds added through its newer payment portal, so this may look underfunded even when it isn't. If the balance shown directly in ${platformName(p)}'s ads manager covers at least a day's minimum spend, you're fine to continue.`,
  },
  {
    test: (d) => /tool\/region does not offer/.test(d),
    friendly: (_d, p) =>
      `${platformName(p)} can't yet reach every market you might target from this account. A campaign aimed at an unsupported market will fail at launch — stick to a confirmed market, or check with ${platformName(p)} support.`,
  },
  {
    test: (d) => /tool\/region did not resolve/.test(d),
    friendly: (_d, p) =>
      `${platformName(p)} can't currently reach its own primary market from this account — that's bigger than a single-market gap. Contact support before launching this channel.`,
  },
  {
    test: (d) => /Public Profile API 403/.test(d),
    friendly: () =>
      "We can't double-check this Snapchat profile ahead of time — Snapchat blocks that lookup. It's verified automatically the first time we create a creative.",
  },
  {
    test: (d) => /meta_page_not_assigned/.test(d),
    friendly: () =>
      "The Facebook Page isn't assigned to our ad account yet. Assign it (with advertising permission) in Meta Business Settings.",
  },
  {
    test: (d) => /Token authenticates but cannot see the configured ad account/.test(d),
    friendly: () =>
      "This connection works, but it can't see the ad account we've configured. Double-check the ad account ID in Settings.",
  },
  {
    test: (d) => /PENDING_BILLING_INFO/.test(d),
    friendly: () =>
      "This ad account can't fund a campaign yet — billing isn't fully set up. Add a payment method in Meta's ads manager, then recheck.",
  },
  {
    test: (d) => /No AVAILABLE TT_USER identity/.test(d),
    friendly: () =>
      "TikTok needs a verified posting identity before it can run ads. Re-authorize the @usemingla TikTok account.",
  },
  {
    test: (d) => /a STATUS_ENABLE advertiser is required/.test(d),
    friendly: () => "This TikTok advertiser account isn't enabled yet. Check its status in TikTok Ads Manager.",
  },
  {
    test: (d) => /zero events|NO_RECENT_ACTIVITY/.test(d),
    friendly: (_d, p) =>
      `This pixel hasn't collected any activity yet, so some smarter goals aren't available until it does. Simpler traffic/install goals still work fine on ${platformName(p)}.`,
  },
  {
    test: (d) => /an ENABLED, non-test, billed account is required/.test(d),
    friendly: () =>
      "This Google Ads account isn't fully active — it may still be a test account or missing billing. Check the account status in Google Ads.",
  },
  {
    test: (d) => /geoTargetConstants:suggest returned no ENABLED/.test(d),
    friendly: () => "We couldn't confirm Google can target this market right now. Recheck, or try a different market.",
  },
  {
    test: (d) => /No ACTIVE pixel on the ad account/.test(d),
    friendly: (_d, p) =>
      `No active pixel on this ${platformName(p)} account. Goals that need it (like 'people who convert') aren't available yet — simpler goals still work fine.`,
  },
  {
    test: (d) => /No ACTIVE funding source/.test(d),
    friendly: (_d, p) =>
      `No active funding source on this ${platformName(p)} account — a launched campaign wouldn't spend. Add one in ${platformName(p)}'s ads manager.`,
  },
  {
    test: (d) => /Organization id unresolved/.test(d),
    friendly: () =>
      "We can't verify Snapchat funding right now — the organization isn't fully configured. This needs an engineering fix, not an account change.",
  },
  {
    test: (d) => /SNAPCHAT_PROFILE_ID missing/.test(d),
    friendly: () =>
      "Snapchat isn't fully set up yet — a required profile is missing. This needs an engineering fix before Snapchat can launch.",
  },
  {
    test: (d) => /an ACTIVE account is required/.test(d),
    friendly: (_d, p) => `This ${platformName(p)} ad account isn't active yet. Check its status in ${platformName(p)}'s ads manager.`,
  },
  {
    test: (d) => /outside Reddit's 8-value enum/.test(d),
    friendly: () =>
      "Reddit can't bill in this account's currency yet — only a specific set of currencies is supported. This needs a funding-source or currency change in Reddit's ads manager.",
  },
  {
    test: (d) => /reasons_not_servable/.test(d),
    friendly: () =>
      "This Reddit funding source isn't usable right now — Reddit flagged a specific reason in its ads manager. Check the funding source there before launching.",
  },
  {
    test: (d) => /No t2_ profile exists on the ad account/.test(d),
    friendly: () =>
      "Reddit needs a posting profile attached to this account before an ad can run (a Reddit ad is a post, and every post needs an author). Set one up in Reddit's ads manager.",
  },
];

// Fallback meaning keyed on (checkId, status) — fires when no PATTERN_RULES
// entry recognizes the raw detail (a live API exception, or a check that
// passed/doesn't apply and carries no jargon to begin with).
const BASELINE = {
  P1: {
    fail: (p) => `We couldn't verify ${platformName(p)}'s connection. Reconnect it in Settings and recheck.`,
    pass: () => "Connected — we can read this account.",
  },
  P2: {
    fail: (p) => `${platformName(p)} isn't ready to fund a campaign yet. Check billing/funding directly in its ads manager.`,
    warn: (p) => `We couldn't fully confirm funding — double-check the balance directly in ${platformName(p)}'s ads manager before launching.`,
    pass: () => "Funding is active and ready to spend.",
  },
  P3: {
    fail: (p) => `${platformName(p)} needs some account setup finished before it can publish. Check its ads manager for what's missing.`,
    pass: (p) => `${platformName(p)} is set up correctly and ready to publish.`,
  },
  P4: {
    fail: (p) => `${platformName(p)} requires a working conversion pixel before this channel can launch. Add one in its ads manager.`,
    warn: () => "This pixel hasn't collected enough activity yet, so some smarter goals aren't available. Simpler goals still work fine.",
    pass: () => "Pixel is active and already collecting signal.",
    "n/a": () => "Conversion tracking isn't available for this platform yet — we optimize for clicks instead, which works today.",
  },
  P5: {
    pass: () => "This account is fully approved — no extra review needed.",
    "n/a": () => "No extra approval step applies to this account.",
  },
  P6: {
    fail: (p) => `We couldn't confirm ${platformName(p)} can reach your target market right now. Recheck, or try a different market.`,
    warn: (p) => `${platformName(p)} can't reach every market yet. A campaign aimed at an unsupported market will fail at launch.`,
    pass: (p) => `We can target your chosen market on ${platformName(p)}.`,
    "n/a": (p) => `${platformName(p)} doesn't need this check — it targets countries directly.`,
  },
  B6: {
    fail: () => "Meta hasn't approved this app for live ads yet. Switch it to Live mode in the Meta App Dashboard, then recheck.",
    pass: () => "Meta's app is live and approved.",
  },
};

const FALLBACK = {
  fail: (p) => `This needs attention before ${platformName(p)} can launch — see the technical details.`,
  warn: (p) => `This works, but has a caveat on ${platformName(p)} — see the technical details.`,
  pass: (p) => `Ready on ${platformName(p)}.`,
  "n/a": (p) => `Doesn't apply to ${platformName(p)}.`,
};

/**
 * @param {object} args
 * @param {string} args.platform
 * @param {string} args.checkId   e.g. "P1".."P6", "B6"
 * @param {"pass"|"fail"|"warn"|"n/a"} args.status
 * @param {string|null} [args.detail] — the raw admin-ad-preflight detail
 * @returns {{friendly: string, technical: string|null}} `friendly` is always
 *   plain English with zero raw proof-tags/error-codes/issue-numbers as the
 *   PRIMARY text; `technical` is the untouched raw detail (null when there
 *   was none), for the support disclosure — never dropped.
 */
export function translatePreflightDetail({ platform, checkId, status, detail }) {
  const raw = detail ?? null;
  if (raw) {
    for (const rule of PATTERN_RULES) {
      if (rule.test(raw)) {
        return { friendly: rule.friendly(raw, platform), technical: raw };
      }
    }
  }
  const byCheck = BASELINE[checkId];
  const fn = byCheck?.[status] ?? FALLBACK[status] ?? FALLBACK.fail;
  return { friendly: fn(platform), technical: raw };
}
