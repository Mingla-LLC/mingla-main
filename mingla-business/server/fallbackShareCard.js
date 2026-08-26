"use strict";
/**
 * #2589 — the fallback share card's pure layer.
 *
 * Everything here is dependency-free, deterministic and total: given the same
 * inputs it returns the same output on every runtime, and it never throws. That
 * matters more here than anywhere else in the share pipeline, because this card
 * IS the fallback — there is nothing behind it. A throw in this file is a 502
 * with an empty body, which is exactly the hole #2589 exists to close.
 *
 * Composition lives in `cardIdentityRenderer.js`; this file owns only the maths
 * and the content ladders, so both can be unit-tested without a rasteriser.
 */

/** The Mingla brand token. Hue 25 is derived from it, never retyped. */
const MINGLA_BRAND_HEX = "#eb7825";
/** Below this HSL saturation a colour carries no usable hue (grey/black/white). */
const ACHROMATIC_SATURATION = 0.15;
/** 312pt plate width minus 2 x 12pt breathing — the stamp value's budget. */
const STAMP_VALUE_MAX_WIDTH = 288;
const HEADLINE_SIZE_LADDER = Object.freeze([46, 38, 32, 26]);
const LABEL_SIZE_LADDER = Object.freeze([28, 24, 20]);
const MONTHS = Object.freeze(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]);
const WEEKDAYS = Object.freeze(["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"]);
/** The producer's only date format: `Intl.DateTimeFormat('en-US', {month:'short', day:'numeric', year:'numeric'})`. */
const PRODUCER_DATE_RE = /^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/;
/** An en dash with a hair space either side. */
const RANGE_SEPARATOR = " – ";

const text = (value) => (typeof value === "string" ? value.trim() : "");

/** FNV-1a over UTF-8 bytes. Deterministic across runtimes; the card's only seed. */
function fnv1a32(value) {
  const bytes = Buffer.from(typeof value === "string" ? value : "", "utf8");
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const srgbToLinear = (channel) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};

/** WCAG 2.x relative luminance. */
const relativeLuminance = (rgb) => 0.2126 * srgbToLinear(rgb[0]) + 0.7152 * srgbToLinear(rgb[1]) + 0.0722 * srgbToLinear(rgb[2]);

/** `h` in degrees (any real, wrapped), `s`/`l` in 0..100. Returns 0..255 channels. */
function hslToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, s)) / 100;
  const lum = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = lum - c / 2;
  const sector = Math.floor(hue / 60) % 6;
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

const toHex = (rgb) => `#${rgb.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();

/** HSL hue + saturation of a `#rgb`/`#rrggbb` string. `null` on anything else. */
function hueOf(value) {
  const raw = text(value);
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (!match) return null;
  const digits = match[1].length === 3 ? match[1].split("").map((d) => d + d).join("") : match[1];
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(digits.slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta === 0) return { h: 0, s: 0 };
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue;
  if (max === r) hue = 60 * (((g - b) / delta) % 6);
  else if (max === g) hue = 60 * ((b - r) / delta + 2);
  else hue = 60 * ((r - g) / delta + 4);
  return { h: ((hue % 360) + 360) % 360, s: Math.min(1, saturation) };
}

/**
 * Hue is borrowed, tone is Mingla's. A host may pick `#FFFF00` or `#111827`;
 * taking only the hue is what stops one brand breaking the family, and taking
 * NOTHING from an achromatic theme is what stops a grey brand rendering a grey
 * card that the scrim was never solved for.
 */
function baseHue(themeColor) {
  const parsed = hueOf(themeColor);
  if (!parsed || parsed.s < ACHROMATIC_SATURATION) {
    const brand = hueOf(MINGLA_BRAND_HEX);
    return Math.round(brand.h);
  }
  return Math.round(parsed.h);
}

/**
 * Bisect HSL lightness until the colour hits `targetY` relative luminance.
 *
 * Luminance is monotonic in L for a fixed hue and saturation, so 60 halvings
 * land well inside 8-bit precision. This is the single reason the card's
 * contrast is hue-INDEPENDENT: a fixed HSL lightness measures 3.85:1 at hue 25
 * and 3.70:1 at hue 240, i.e. it fails the 3.0 floor's margin somewhere in the
 * middle of the circle. Normalising luminance instead holds 3.77-3.85 across
 * all 360 degrees.
 */
function lightnessForLuminance(hue, saturation, targetY) {
  let low = 0;
  let high = 100;
  for (let i = 0; i < 60; i += 1) {
    const mid = (low + high) / 2;
    if (relativeLuminance(hslToRgb(hue, saturation, mid)) < targetY) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/** The three field stops. Saturation and target luminance are Mingla's; only hue moves. */
const FIELD_STOPS = Object.freeze([
  Object.freeze({ position: 0, hueDelta: 0, saturation: 86, targetY: 0.58 }),
  Object.freeze({ position: 55, hueDelta: -14, saturation: 78, targetY: 0.26 }),
  Object.freeze({ position: 100, hueDelta: -26, saturation: 62, targetY: 0.06 }),
]);

function fieldStops(hue) {
  return FIELD_STOPS.map((stop) => toHex(hslToRgb(hue + stop.hueDelta, stop.saturation, lightnessForLuminance(hue + stop.hueDelta, stop.saturation, stop.targetY))));
}

const HUE_SHIFTS = Object.freeze([-22, -13, -4, 4, 13, 22]);
const ANGLES = Object.freeze([152, 168, 196, 212]);
const HIGHLIGHT_X = Object.freeze([24, 38, 62, 76]);
const HIGHLIGHT_Y = Object.freeze([16, 24, 12, 20]);

/**
 * 384 deterministic combinations seeded by the SHORT CODE, not the brand id —
 * which is the whole point. Two offerings from one brand share a colour family
 * and differ in hue, angle and highlight, so a brand's cards are recognisable
 * without being identical. The determinism is not cosmetic: the render is
 * cached `immutable` under `content-share-<code>-v<n>-r2-jpeg`, so the same
 * code must produce the same bytes forever.
 */
function fieldFor(shortCode, themeColor) {
  const seed = fnv1a32(text(shortCode));
  const hue = baseHue(themeColor) + HUE_SHIFTS[seed % HUE_SHIFTS.length];
  return {
    hue,
    angle: ANGLES[(seed >>> 3) % ANGLES.length],
    highlightX: HIGHLIGHT_X[(seed >>> 6) % HIGHLIGHT_X.length],
    highlightY: HIGHLIGHT_Y[(seed >>> 9) % HIGHLIGHT_Y.length],
    stops: fieldStops(hue),
  };
}

/** `"Aug 8, 2026"` -> `{day:8, month:7, mon:'AUG', year:2026, weekday:'FRI'}`. `null` on any mismatch. */
function parseProducerDate(value) {
  const match = PRODUCER_DATE_RE.exec(text(value));
  if (!match) return null;
  const month = MONTHS.indexOf(match[1].toUpperCase());
  const day = Number(match[2]);
  const year = Number(match[3]);
  if (month < 0 || !Number.isInteger(day) || day < 1 || day > 31 || !Number.isInteger(year)) return null;
  const utc = new Date(Date.UTC(year, month, day));
  // Reject Feb 30 and friends: `Date.UTC` rolls them forward silently.
  if (utc.getUTCMonth() !== month || utc.getUTCDate() !== day) return null;
  // A calendar date has exactly one weekday regardless of timezone, so reading
  // it back in UTC is deterministic and needs no zone.
  return { day, month, mon: MONTHS[month], year, weekday: WEEKDAYS[utc.getUTCDay()] };
}

const pad2 = (value) => String(value).padStart(2, "0");

/** `"Aug 8, 2026 – Aug 12, 2026"` -> `{value, meta}`. `null` when either half misses. */
function formatDateRange(value) {
  const halves = text(value).split(/\s*[–—-]\s*/);
  if (halves.length !== 2) return null;
  const from = parseProducerDate(halves[0]);
  const to = parseProducerDate(halves[1]);
  if (!from || !to) return null;
  if (from.year !== to.year) {
    return {
      value: `${pad2(from.day)} ${from.mon} ${pad2(from.year % 100)}${RANGE_SEPARATOR}${pad2(to.day)} ${to.mon} ${pad2(to.year % 100)}`,
      meta: [from.weekday, String(from.year)].join(" · "),
    };
  }
  const value2 = from.month === to.month
    ? `${from.day}${RANGE_SEPARATOR}${to.day} ${to.mon}`
    : `${from.day} ${from.mon}${RANGE_SEPARATOR}${to.day} ${to.mon}`;
  return { value: value2, meta: [from.weekday, String(from.year)].join(" · ") };
}

/**
 * Per-character advance estimate for uppercase Inter/Arial at a given size.
 *
 * Satori measures glyphs at raster time, which this pure layer cannot reach, so
 * the auto-fit ladder budgets width the same way `portraitTitleSize()` already
 * budgets the title: from the string, deterministically. The ratios are
 * deliberately generous — over-estimating steps the size down one rung early,
 * which is safe; under-estimating clips, which is not.
 */
function estimateUppercaseWidth(value, size, letterSpacing) {
  const characters = Array.from(text(value));
  if (!characters.length) return 0;
  let ems = 0;
  for (const character of characters) {
    if (/\d/.test(character)) ems += 0.6;
    else if (/[A-Z]/.test(character)) ems += 0.68;
    else if (/\s/.test(character)) ems += 0.28;
    else ems += 0.42;
  }
  return ems * size + Math.max(0, characters.length - 1) * letterSpacing;
}

/** Step down the variant's ladder until the value fits 288pt; clip at the last rung. */
function autoFitSize(value, ladder, letterSpacing) {
  for (const size of ladder) {
    if (estimateUppercaseWidth(value, size, letterSpacing) <= STAMP_VALUE_MAX_WIDTH) return size;
  }
  return ladder[ladder.length - 1];
}

const HEADLINE_VARIANT = Object.freeze({ variant: "headline", ladder: HEADLINE_SIZE_LADDER, letterSpacing: -1, weight: 800, tabular: true, padding: [12, 18, 13] });
const LABEL_VARIANT = Object.freeze({ variant: "label", ladder: LABEL_SIZE_LADDER, letterSpacing: 1.6, weight: 700, tabular: false, padding: [14, 18, 14] });

const dotJoin = (parts) => parts.filter(Boolean).join(" · ");

/**
 * The stamp's content ladder — date, then range, then stop count, then category,
 * then nothing. Every rung reads a fact the offering already owns; a missing
 * fact REMOVES its rung, and the bottom of the ladder is no stamp at all. There
 * is no rung that invents a value.
 *
 * `consumedKeys` names the facts the stamp took, so the plate can re-select
 * without them and nothing appears twice. It is a list of KEYS, never of
 * location fields: this card reads no `venue`, `area` or `destination`, so a
 * gated offering and an ungated one produce identical geometry (#2489/#2587).
 */
function stampContent(facts) {
  const source = facts && typeof facts === "object" ? facts : {};
  const kind = source.kind;
  const verbatim = (value, variant, meta) => {
    const clean = text(value);
    if (!clean) return null;
    const upper = clean.toUpperCase();
    return { ...variant, value: upper, meta: text(meta), size: autoFitSize(upper, variant.ladder, variant.letterSpacing) };
  };
  const dated = (raw, keys) => {
    const clean = text(raw);
    if (!clean) return null;
    const parsed = parseProducerDate(clean);
    // Regex miss: render the producer's string verbatim and drop the meta row.
    // Never guess a shape, never drop the date.
    const built = parsed
      ? verbatim(`${parsed.day} ${parsed.mon}`, HEADLINE_VARIANT, dotJoin([parsed.weekday, String(parsed.year), text(source.localTime)]))
      : verbatim(clean, HEADLINE_VARIANT, "");
    return built ? { ...built, consumedKeys: keys } : null;
  };

  if (kind === "event" || kind === "rsvp_event") return dated(source.localDate, ["localDate", "localTime"]);
  if (kind === "experience") return dated(source.nextDate, ["nextDate"]);
  if (kind === "trip") {
    const clean = text(source.dateRange);
    if (!clean) return null;
    const range = formatDateRange(clean);
    const built = range ? verbatim(range.value, HEADLINE_VARIANT, range.meta) : verbatim(clean, HEADLINE_VARIANT, "");
    return built ? { ...built, consumedKeys: ["dateRange"] } : null;
  }
  if (kind === "curated") {
    const stops = source.stopCount;
    if (!Number.isSafeInteger(stops) || stops <= 0) return null;
    const built = verbatim(`${stops} stop${stops === 1 ? "" : "s"}`, HEADLINE_VARIANT, dotJoin([kindLabelFor(kind), text(source.duration)]).toUpperCase());
    return built ? { ...built, consumedKeys: ["stopCount", "duration"] } : null;
  }
  if (kind === "place" || kind === "venue" || kind === "brand") {
    const built = verbatim(source.category, LABEL_VARIANT, "");
    return built ? { ...built, consumedKeys: ["category"] } : null;
  }
  return null;
}

/** Mirrors the plate's own label table; the stamp must never coin a second name for a kind. */
const kindLabelFor = (kind) => ({ place: "Place", curated: "Curated plan", event: "Event", rsvp_event: "RSVP event", trip: "Trip", experience: "Experience", venue: "Venue", brand: "Brand" })[kind] || "";

module.exports = {
  ACHROMATIC_SATURATION,
  RANGE_SEPARATOR,
  HEADLINE_SIZE_LADDER,
  LABEL_SIZE_LADDER,
  MINGLA_BRAND_HEX,
  STAMP_VALUE_MAX_WIDTH,
  autoFitSize,
  baseHue,
  estimateUppercaseWidth,
  fieldFor,
  fieldStops,
  fnv1a32,
  formatDateRange,
  hslToRgb,
  hueOf,
  lightnessForLuminance,
  parseProducerDate,
  relativeLuminance,
  stampContent,
};
