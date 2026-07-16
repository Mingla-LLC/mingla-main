/**
 * ISSUE-864 WP4 [Campaign Builder] — A4.b: per-channel copy caps, NEVER one
 * shared cap. One shared composer, per-channel counters, per-channel hard
 * caps + the live truncation preview (blueprint §1.6).
 *
 * The binding numbers (blueprint §1.6 limits table, verbatim):
 *  - Meta: primary ≤1024 HARD; warn >125 (mobile-feed "See more" — render-
 *    driven, NEVER reject at 125); warn >60 (FB Reels overlay). Headline ≤255
 *    HARD; warn >27 (FB Feed), >40 (IG), >10 (FB Reels). Description ≤255.
 *  - TikTok: ad_text ≤100 HARD, NO EMOJI (strip-with-explanation — emoji only
 *    reach TikTok via Spark Ads).
 *  - Snapchat: headline ≤34 HARD; brand_name ≤32 (leaving it null is often
 *    safer — defaults to the Public Profile's brand name).
 *  - Google RSA: 3–15 headlines ≤30 each; 2–4 descriptions ≤90 each;
 *    keywords REQUIRED for Search; NO call_to_action_type (not an RSA field).
 *  - Reddit: headline policy ≤300 BLOCK (passes create with a 201, fails
 *    review hours later — validation is ours), >100 WARN, >80 WARN;
 *    ALL-CAPS BLOCK (Reddit has a literal CAPITALIZATION rejection reason;
 *    Google rejects the same pattern).
 *
 * Counting: CJK/double-width characters count ×2 (TikTok verbatim; Google
 * same rule) — counters count by WEIGHT, not .length.
 */

// ── Weighted counting (blueprint §1.6 counting rules) ─────────────────────────
const DOUBLE_WIDTH_RANGES = [
  [0x1100, 0x115f], // Hangul Jamo
  [0x2e80, 0x303e], // CJK Radicals … CJK Symbols and Punctuation
  [0x3041, 0x33ff], // Hiragana, Katakana, CJK compat
  [0x3400, 0x4dbf], // CJK Ext A
  [0x4e00, 0x9fff], // CJK Unified
  [0xa000, 0xa4cf], // Yi
  [0xac00, 0xd7a3], // Hangul syllables
  [0xf900, 0xfaff], // CJK compat ideographs
  [0xfe30, 0xfe4f], // CJK compat forms
  [0xff00, 0xff60], // Fullwidth forms
  [0xffe0, 0xffe6], // Fullwidth signs
  [0x20000, 0x2fa1f], // CJK Ext B+
];

function isDoubleWidth(codePoint) {
  return DOUBLE_WIDTH_RANGES.some(([lo, hi]) => codePoint >= lo && codePoint <= hi);
}

/** Weighted length: double-width (CJK/Korean/Japanese/fullwidth) count as 2. */
export function weightedLength(text) {
  if (!text) return 0;
  let total = 0;
  for (const ch of text) {
    total += isDoubleWidth(ch.codePointAt(0)) ? 2 : 1;
  }
  return total;
}

// ── Emoji (TikTok ad_text forbids them on non-Spark ads) ─────────────────────
const EMOJI_REGEX = /\p{Extended_Pictographic}|️|‍/gu;

export function containsEmoji(text) {
  if (!text) return false;
  EMOJI_REGEX.lastIndex = 0;
  return EMOJI_REGEX.test(text);
}

/** Strip emoji (for the TikTok rendition only — other channels keep them). */
export function stripEmoji(text) {
  if (!text) return { text: "", stripped: 0 };
  EMOJI_REGEX.lastIndex = 0;
  const matches = text.match(EMOJI_REGEX) ?? [];
  const stripped = matches.filter((m) => m !== "️" && m !== "‍").length;
  return {
    text: text.replace(EMOJI_REGEX, "").replace(/\s{2,}/g, " ").trim(),
    stripped,
  };
}

export const TIKTOK_EMOJI_EXPLANATION =
  "TikTok doesn't allow emoji in ad text on a normal ad. We stripped them for the TikTok version — the other channels keep them. (Emoji only work on TikTok through Spark Ads, which use the original post's caption.)";

/** ALL-CAPS detector (Reddit CAPITALIZATION / Google editorial). */
export function isAllCaps(text) {
  if (!text) return false;
  const letters = text.replace(/[^A-Za-z]/g, "");
  if (letters.length < 4) return false;
  const upper = letters.replace(/[^A-Z]/g, "");
  return upper.length / letters.length > 0.9;
}

// ── The caps table (blueprint §1.6, verbatim) ─────────────────────────────────
export const COPY_CAPS = {
  meta: {
    primary: { hard: 1024, warns: [{ at: 125, note: "mobile-feed 'See more'" }, { at: 60, note: "FB Reels overlay" }] },
    headline: { hard: 255, warns: [{ at: 27, note: "FB Feed" }, { at: 40, note: "IG" }, { at: 10, note: "FB Reels overlay" }] },
    description: { hard: 255, warns: [{ at: 30, note: "Marketplace" }] },
  },
  tiktok: { primary: { hard: 100, noEmoji: true } },
  snapchat: { headline: { hard: 34 }, brandName: { hard: 32 } },
  google: {
    headline: { hard: 30, minCount: 3, maxCount: 15 },
    description: { hard: 90, minCount: 2, maxCount: 4 },
    businessName: { hard: 25 },
    keyword: { maxChars: 80, maxWords: 10 },
    maxEnabledRsasPerAdGroup: 3,
  },
  reddit: {
    headline: { policyBlock: 300, warns: [{ at: 100 }, { at: 80 }] },
  },
};

/**
 * Validate the shared composer against ONE channel. Returns
 * { hard: string[], warn: string[] } — hard blocks Next for that channel,
 * warn annotates. `fields` = { primary, headline, description, googleHeadlines,
 * googleDescriptions, keywords, brandName }.
 */
export function validateCopyForChannel(platform, fields) {
  const hard = [];
  const warn = [];
  const primary = fields.primary ?? "";
  const headline = fields.headline ?? "";
  const description = fields.description ?? "";
  const wl = weightedLength;

  if (platform === "meta") {
    if (wl(primary) > 1024) hard.push(`Facebook's hard limit is 1,024 characters. You're at ${wl(primary)}.`);
    else if (wl(primary) > 125) {
      // A4.b contract: "Do not reject at 125" — truncation is render-driven.
      warn.push(`Past about 125 characters Facebook shows a 'See more' link on mobile — your first line is doing all the work. (${wl(primary)} characters.)`);
    }
    if (wl(headline) > 255) hard.push(`Facebook's headline hard limit is 255. You're at ${wl(headline)}.`);
    else if (wl(headline) > 27) warn.push(`Facebook Feed shows about 27 characters of a headline. Yours is ${wl(headline)} — the rest gets cut.`);
    if (wl(description) > 255) hard.push(`Facebook's description hard limit is 255. You're at ${wl(description)}.`);
  }

  if (platform === "tiktok") {
    const { text: stripped, stripped: strippedCount } = stripEmoji(primary);
    if (strippedCount > 0) warn.push(TIKTOK_EMOJI_EXPLANATION);
    if (wl(stripped) > 100) {
      hard.push(`TikTok's limit is 100 characters and it's a hard one — you're at ${wl(stripped)}. Trim it.`);
    }
  }

  if (platform === "snapchat") {
    if (wl(headline) > 34) hard.push(`Snapchat's headline limit is 34 characters. You're at ${wl(headline)}.`);
    const brandName = fields.brandName ?? "";
    if (wl(brandName) > 32) {
      hard.push("Snapchat's brand name limit is 32 characters. Leaving it blank is often safer — it defaults to the Public Profile's brand name, which guarantees a policy match.");
    }
  }

  if (platform === "google") {
    const headlines = (fields.googleHeadlines ?? []).map((h) => (h ?? "").trim()).filter(Boolean);
    const descriptions = (fields.googleDescriptions ?? []).map((d) => (d ?? "").trim()).filter(Boolean);
    if (headlines.length < 3) {
      hard.push("Google needs at least 3 headlines — it mixes and matches them. Give it 15 if you can; more combinations means better performance.");
    }
    if (headlines.length > 15) hard.push("Google takes at most 15 headlines.");
    for (const h of headlines) {
      if (wl(h) > 30) hard.push(`Google headlines cap at 30 characters. '${h}' is ${wl(h)}.`);
    }
    if (descriptions.length < 2) hard.push("Google needs at least 2 descriptions (max 4).");
    if (descriptions.length > 4) hard.push("Google takes at most 4 descriptions.");
    for (const d of descriptions) {
      if (wl(d) > 90) hard.push("Google descriptions cap at 90 characters.");
    }
    const keywords = (fields.keywords ?? []).map((k) => (k ?? "").trim()).filter(Boolean);
    if (keywords.length === 0) {
      hard.push("A Google Search campaign without keywords can't really serve. Add a few — we suggest starting with the venue name, the neighbourhood, and what people would type to find this kind of night out.");
    }
    for (const k of keywords) {
      if (k.length > 80 || k.split(/\s+/).length > 10) {
        hard.push("Google keywords cap at 80 characters and 10 words.");
      }
    }
    for (const line of [...headlines, ...descriptions]) {
      if (isAllCaps(line)) {
        hard.push("Drop the ALL CAPS / the extra exclamation marks — both Google and Reddit reject ads for it. (Reddit literally has a rejection reason called CAPITALIZATION.)");
        break;
      }
    }
  }

  if (platform === "reddit") {
    // Reddit's ad "headline" is fed from the primary text (blueprint §1.6 fields).
    const redditHeadline = primary;
    const n = wl(redditHeadline);
    if (n > 300) {
      hard.push(`Reddit's policy limit is 300 characters — you're at ${n}, and it'll pass create then get rejected hours later.`);
    } else if (n > 100) {
      warn.push(`Over ~100 characters starts reading like an ad. Reddit punishes that. (${n} characters.)`);
    } else if (n > 80) {
      warn.push(`Reddit favours short, plain headlines — you're at ${n} (soft bar ~80).`);
    }
    if (isAllCaps(redditHeadline) || isAllCaps(headline)) {
      hard.push("Drop the ALL CAPS — Reddit literally has a rejection reason called CAPITALIZATION.");
    }
  }

  return { hard, warn };
}

/** Validate against every channel in the set → { platform: {hard, warn} }. */
export function validateCopy(fields, platforms) {
  const result = {};
  for (const platform of platforms) {
    result[platform] = validateCopyForChannel(platform, fields);
  }
  return result;
}

// ── The live truncation preview strip (blueprint §1.6 mock) ───────────────────
function truncate(text, at) {
  if (!text) return "";
  if (weightedLength(text) <= at) return text;
  let out = "";
  let total = 0;
  for (const ch of text) {
    total += isDoubleWidth(ch.codePointAt(0)) ? 2 : 1;
    if (total > at) break;
    out += ch;
  }
  return `${out.trimEnd()}…`;
}

/**
 * Rows for the truncation strip: exactly what each surface renders.
 * `fields` as in validateCopyForChannel; `platforms` filters the rows.
 */
export function truncationPreview(fields, platforms) {
  const primary = fields.primary ?? "";
  const headline = fields.headline ?? "";
  const rows = [];
  const has = (p) => platforms.includes(p);

  if (has("meta")) {
    rows.push({
      surface: "Facebook Feed",
      text: truncate(primary, 125),
      suffix: weightedLength(primary) > 125 ? "[See more]" : null,
    });
    rows.push({ surface: "Instagram Feed", text: truncate(primary, 125), suffix: null });
    rows.push({
      surface: "FB Reels overlay",
      text: truncate(primary, 60),
      suffix: headline ? `headline: "${truncate(headline, 10)}"` : null,
    });
  }
  if (has("tiktok")) {
    const { text: stripped, stripped: strippedCount } = stripEmoji(primary);
    const n = weightedLength(stripped);
    rows.push({
      surface: "TikTok",
      text: truncate(stripped, 100),
      suffix: `${n <= 100 ? "✓" : "✗"} ${n}/100${strippedCount > 0 ? ` (${strippedCount} emoji stripped)` : ""}`,
    });
  }
  if (has("snapchat")) {
    const n = weightedLength(headline);
    rows.push({
      surface: "Snapchat",
      text: `headline: "${truncate(headline, 34)}"`,
      suffix: `${n <= 34 ? "✓" : "✗"} ${n}/34`,
    });
  }
  if (has("google")) {
    const headlines = (fields.googleHeadlines ?? []).map((h) => (h ?? "").trim()).filter(Boolean);
    rows.push({
      surface: "Google RSA",
      text: headlines.slice(0, 2).map((h, i) => `H${i + 1} "${truncate(h, 30)}"`).join("  "),
      suffix: `(${headlines.length} of 15${headlines.length < 15 ? " — add more" : ""})`,
    });
  }
  if (has("reddit")) {
    const n = weightedLength(primary);
    rows.push({
      surface: "Reddit",
      text: truncate(primary, 100),
      suffix: `${n <= 300 ? "✓" : "✗"} ${n}${n > 80 ? " (warn >80)" : ""}`,
    });
  }
  return rows;
}

// ── CTA options (Meta enum — the only channel whose create payload takes it) ──
// A4.b: call_to_action_type is Meta/TikTok/Snap/Reddit only — NEVER sent to
// Google (not an RSA field; Search ads have no CTA button). Today only Meta's
// create path is wired, so only Meta's enum is exposed.
export const META_CTA_OPTIONS = [
  "BUY_TICKETS",
  "BOOK_NOW",
  "GET_DIRECTIONS",
  "EVENT_RSVP",
  "LEARN_MORE",
  "SIGN_UP",
];
