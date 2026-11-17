/**
 * #2829 AD-3 — the three font slots a site has, and the self-hosted files an
 * artifact carries for them.
 *
 * An owner may choose ANY family in the Google Fonts catalogue for the
 * display, body and (optional) accent script slots. A visitor's browser never
 * contacts Google: at publish the builder downloads the woff2 files once,
 * stores them content-addressed, and the artifact lists them as `font_assets`
 * served from the site's own `/fonts/<digest>` route.
 *
 * Family names are interpolated into CSS, so they are a closed shape (letters,
 * digits, spaces, hyphens) checked here and again at the point of emission.
 */

/*
 * #4453 §3.2 — `label` is the fourth slot: the face a design sets labels,
 * dates and prices in (a mono or a narrow sans). It is optional per design
 * and falls back to `body` when a design declares none. Owners cannot
 * override it in #4453: the owner-facing slots stay display, body, accent.
 */
export const FONT_SLOT_KEYS = ["display", "body", "accent", "label"] as const;
export type FontSlotKey = (typeof FONT_SLOT_KEYS)[number];
/** The slots an owner (Studio, Business, Ari) may choose a family for. */
export const OWNER_FONT_SLOT_KEYS = ["display", "body", "accent"] as const;
export type OwnerFontSlotKey = (typeof OWNER_FONT_SLOT_KEYS)[number];
export type FontSource = "google" | "system";
export type FontStyle = "normal" | "italic";

export type FontSlot = {
  family: string;
  source: FontSource;
  /** The weights the design draws this slot in (resolved to what the family has). */
  weights: number[];
  italic: boolean;
  /**
   * #4453 6b — the variable-font axes the design draws this slot with, each a
   * [min, max] range (a pinned instance is [v, v]): `wdth` (Archivo's
   * compressed and wide cuts, emitted as font-stretch), `opsz` (optical
   * size, which the browser applies automatically), and Fraunces' `SOFT` and
   * `WONK`. Set only by a design, inside its family's own axes (FONT_AXES);
   * absent means the family's default instance. An owner's own family never
   * inherits them.
   */
  axes?: FontAxes;
};

/** #4453 6b — the variable-font axes the publish pipeline can self-host (css2 tags). */
export const FONT_AXIS_TAGS = ["opsz", "wdth", "SOFT", "WONK"] as const;
export type FontAxisTag = (typeof FONT_AXIS_TAGS)[number];
export type FontAxes = Readonly<Partial<Record<FontAxisTag, readonly [number, number]>>>;

/**
 * #4453 6b — the axes of each catalogue family a design draws with them,
 * exactly as Google's public font metadata declares them
 * (fonts.google.com/metadata/fonts, checked 2026-11-16). A design slot's
 * axes must sit inside its family's ranges (the design tests pin it).
 */
export const FONT_AXES: Readonly<Record<string, FontAxes>> = {
  Archivo: { wdth: [62, 125] },
  Fraunces: { opsz: [9, 144], SOFT: [0, 100], WONK: [0, 1] },
};

/** `font-stretch` for a face fetched with a width range ("62% 125%"), else null. */
export function fontStretch(axes: FontAxes | undefined): string | null {
  const wdth = axes?.wdth;
  return wdth && wdth[0] < wdth[1] ? `${wdth[0]}% ${wdth[1]}%` : null;
}

export type FontSlots = {
  display: FontSlot;
  body: FontSlot;
  /** Optional script/accent face; null when the design or owner uses none. */
  accent: FontSlot | null;
  /**
   * #4453 — optional label face (labels, dates, prices). Absent or null means
   * labels use the body face. Artifacts published before #4453 have no key.
   */
  label?: FontSlot | null;
};

/** The face labels are set in: the label slot, else the body slot. */
export function labelSlot(slots: FontSlots): FontSlot {
  return slots.label ?? slots.body;
}

/** Every Google-hosted family a site's slots name (display, body, accent, label). */
export function slotFamilies(slots: FontSlots): Set<string> {
  return new Set(
    [slots.display, slots.body, slots.accent, slots.label ?? null]
      .filter((slot): slot is FontSlot => slot !== null && slot.source === "google")
      .map((slot) => slot.family),
  );
}

/** What an owner stores: a family per slot; weights come from the design. */
export type OwnerFontChoice = { family: string; source: FontSource };
export type OwnerFontOverrides = Partial<Record<"display" | "body", OwnerFontChoice>> & {
  accent?: OwnerFontChoice | null;
};

/** One downloaded woff2 face, as recorded in an artifact. */
export type FontAsset = {
  family: string;
  weight: number;
  style: FontStyle;
  /** CSS unicode-range exactly as Google declared it ("" = whole font). */
  unicode_range: string;
  /** SHA-256 of the woff2 bytes; the file is served at /fonts/<digest>. */
  digest: string;
  bytes: number;
  /** #4453 6b — the face's width range ("62% 125%") when its slot has a width axis; absent = normal width. */
  stretch?: string;
};

/** Metric overrides for a "<Family> Fallback" face over a local system font. */
export type FontFallback = {
  family: string;
  local: "Arial" | "Times New Roman";
  size_adjust: string;
  ascent_override: string;
  descent_override: string;
  line_gap_override: string;
};

export const MAX_FONT_ASSETS = 24;
export const MAX_FONT_FILE_BYTES = 1.5 * 1024 * 1024;
export const MAX_SITE_FONT_BYTES = 6 * 1024 * 1024;

/** System families that need no download (always available or generic). */
export const SYSTEM_FONT_FAMILIES = [
  "system-ui",
  "Georgia",
  "Times New Roman",
  "Arial",
  "Helvetica",
  "Verdana",
] as const;

const FAMILY = /^[A-Za-z0-9](?:[A-Za-z0-9 -]{0,62}[A-Za-z0-9])?$/;
const DIGEST = /^[0-9a-f]{64}$/;
const UNICODE_RANGE = /^(?:U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?)(?:, ?U\+[0-9A-F?]{1,6}(?:-[0-9A-F]{1,6})?)*$/i;
const PERCENT = /^\d{1,3}(?:\.\d{1,4})?%$/;
const STRETCH = /^\d{2,3}% \d{2,3}%$/;

/** Axes a slot may carry: known tags only, each two whole numbers 0 to 1000, min ≤ max (wdth 25 to 200). */
export function isFontAxes(value: unknown): value is FontAxes {
  if (!plain(value) || Object.keys(value).length === 0) return false;
  return Object.entries(value).every(([tag, range]) =>
    (FONT_AXIS_TAGS as readonly string[]).includes(tag) && Array.isArray(range) && range.length === 2 &&
    range.every((v) => Number.isInteger(v) && v >= (tag === "wdth" ? 25 : 0) && v <= (tag === "wdth" ? 200 : 1000)) &&
    (range[0] as number) <= (range[1] as number));
}

export function isFontFamilyName(value: unknown): value is string {
  return typeof value === "string" && FAMILY.test(value) && !/ {2}/.test(value);
}

export function isFontWeight(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 100 && value <= 900 && value % 100 === 0;
}

function plain(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSlot(value: unknown, path: string): asserts value is FontSlot {
  const fail = (): never => {
    throw new Error(`ARTIFACT_FONTS_MISMATCH:${path}`);
  };
  if (!plain(value)) fail();
  const slot = value as Record<string, unknown>;
  const keys = ["family", "source", "weights", "italic"];
  // #4453 6b — `axes` is optional (a design's variable-font axes).
  if (Object.keys(slot).some((key) => !keys.includes(key) && key !== "axes") || !keys.every((key) => key in slot)) fail();
  if (slot.axes !== undefined && (!isFontAxes(slot.axes) || slot.source !== "google")) fail();
  if (!isFontFamilyName(slot.family)) fail();
  if (slot.source !== "google" && slot.source !== "system") fail();
  if (slot.source === "system" && !(SYSTEM_FONT_FAMILIES as readonly string[]).includes(String(slot.family))) fail();
  if (!Array.isArray(slot.weights) || slot.weights.length < 1 || slot.weights.length > 9) fail();
  const weights = slot.weights as unknown[];
  if (!weights.every(isFontWeight) || new Set(weights).size !== weights.length) fail();
  if (typeof slot.italic !== "boolean") fail();
}

export function assertFontSlots(value: unknown): asserts value is FontSlots {
  if (!plain(value)) throw new Error("ARTIFACT_FONTS_MISMATCH:fonts");
  const slots = value as Record<string, unknown>;
  const keys = Object.keys(slots);
  // Exactly display, body and accent, plus (#4453) an optional label.
  if (
    keys.some((key) => !(FONT_SLOT_KEYS as readonly string[]).includes(key)) ||
    !["display", "body", "accent"].every((key) => keys.includes(key))
  ) {
    throw new Error("ARTIFACT_FONTS_MISMATCH:fonts");
  }
  assertSlot(slots.display, "display");
  assertSlot(slots.body, "body");
  if (slots.accent !== null) assertSlot(slots.accent, "accent");
  if (slots.label !== undefined && slots.label !== null) assertSlot(slots.label, "label");
}

export function assertFontAssets(value: unknown, slots: FontSlots): asserts value is FontAsset[] {
  const fail = (path: string): never => {
    throw new Error(`ARTIFACT_FONT_ASSETS_MISMATCH:${path}`);
  };
  if (!Array.isArray(value) || value.length > MAX_FONT_ASSETS) fail("font_assets");
  const families = slotFamilies(slots);
  let total = 0;
  const seen = new Set<string>();
  (value as unknown[]).forEach((entry, index) => {
    if (!plain(entry)) fail(String(index));
    const asset = entry as Record<string, unknown>;
    const keys = ["family", "weight", "style", "unicode_range", "digest", "bytes"];
    // #4453 6b — `stretch` is optional (a face fetched with its width axis).
    if (Object.keys(asset).some((key) => !keys.includes(key) && key !== "stretch") || !keys.every((key) => key in asset)) fail(String(index));
    if (asset.stretch !== undefined && (typeof asset.stretch !== "string" || !STRETCH.test(asset.stretch))) fail(`${index}.stretch`);
    if (!isFontFamilyName(asset.family) || !families.has(asset.family as string)) fail(`${index}.family`);
    if (!isFontWeight(asset.weight)) fail(`${index}.weight`);
    if (asset.style !== "normal" && asset.style !== "italic") fail(`${index}.style`);
    if (typeof asset.unicode_range !== "string" || (asset.unicode_range !== "" && !UNICODE_RANGE.test(asset.unicode_range)) || asset.unicode_range.length > 2000) {
      fail(`${index}.unicode_range`);
    }
    if (typeof asset.digest !== "string" || !DIGEST.test(asset.digest)) fail(`${index}.digest`);
    if (typeof asset.bytes !== "number" || !Number.isInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > MAX_FONT_FILE_BYTES) fail(`${index}.bytes`);
    const key = `${asset.family}|${asset.weight}|${asset.style}|${asset.unicode_range}`;
    if (seen.has(key)) fail(`${index}.duplicate`);
    seen.add(key);
    // A file shared by several faces (a variable font) counts once.
    total += asset.bytes as number;
  });
  const unique = new Map((value as FontAsset[]).map((asset) => [asset.digest, asset.bytes]));
  total = [...unique.values()].reduce((sum, bytes) => sum + bytes, 0);
  if (total > MAX_SITE_FONT_BYTES) fail("total_bytes");
}

export function assertFontFallbacks(value: unknown, slots: FontSlots): asserts value is FontFallback[] {
  const fail = (path: string): never => {
    throw new Error(`ARTIFACT_FONT_FALLBACKS_MISMATCH:${path}`);
  };
  if (!Array.isArray(value) || value.length > 4) fail("font_fallbacks");
  const families = slotFamilies(slots);
  (value as unknown[]).forEach((entry, index) => {
    if (!plain(entry)) fail(String(index));
    const fallback = entry as Record<string, unknown>;
    const keys = ["family", "local", "size_adjust", "ascent_override", "descent_override", "line_gap_override"];
    if (Object.keys(fallback).length !== keys.length || Object.keys(fallback).some((key) => !keys.includes(key))) fail(String(index));
    if (!isFontFamilyName(fallback.family) || !families.has(fallback.family as string)) fail(`${index}.family`);
    if (fallback.local !== "Arial" && fallback.local !== "Times New Roman") fail(`${index}.local`);
    for (const key of ["size_adjust", "ascent_override", "descent_override", "line_gap_override"]) {
      if (typeof fallback[key] !== "string" || !PERCENT.test(fallback[key] as string)) fail(`${index}.${key}`);
    }
  });
}

/** Validates what an owner stored for fonts (Studio, Business, Ari). */
export function assertOwnerFontOverrides(value: unknown): asserts value is OwnerFontOverrides {
  const fail = (path: string): never => {
    throw new Error(`FONTS_INVALID:${path}`);
  };
  if (value == null) return;
  if (!plain(value)) fail("fonts");
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!(OWNER_FONT_SLOT_KEYS as readonly string[]).includes(key)) fail(key);
    if (key === "accent" && entry === null) continue;
    if (!plain(entry)) fail(key);
    const choice = entry as Record<string, unknown>;
    if (Object.keys(choice).some((field) => field !== "family" && field !== "source")) fail(key);
    if (!isFontFamilyName(choice.family)) fail(`${key}.family`);
    if (choice.source !== "google" && choice.source !== "system") fail(`${key}.source`);
    if (choice.source === "system" && !(SYSTEM_FONT_FAMILIES as readonly string[]).includes(String(choice.family))) {
      fail(`${key}.family`);
    }
  }
}

/** Nearest weight a family offers to the one a design wants (ties go heavier). */
export function nearestWeight(wanted: number, available: readonly number[]): number {
  let best = available[0]!;
  for (const weight of available) {
    const distance = Math.abs(weight - wanted);
    const bestDistance = Math.abs(best - wanted);
    if (distance < bestDistance || (distance === bestDistance && weight > best)) best = weight;
  }
  return best;
}

/**
 * Design slots + owner choices → the slots frozen into an artifact. Weights
 * stay the design's (layout rhythm is the design's), mapped onto what the
 * chosen family actually offers. `availableWeights` returns null for a family
 * outside the catalogue, which keeps the design's family for that slot.
 */
export function resolveFontSlots(
  design: FontSlots,
  owner: OwnerFontOverrides | null | undefined,
  availableWeights: (family: string) => readonly number[] | null,
): FontSlots {
  const resolve = (base: FontSlot, choice: OwnerFontChoice | undefined): FontSlot => {
    if (!choice || choice.family === base.family) return { ...base, weights: [...base.weights] };
    if (choice.source === "system") return { family: choice.family, source: "system", weights: [...base.weights], italic: false };
    const available = availableWeights(choice.family);
    if (!available || available.length === 0) return { ...base, weights: [...base.weights] };
    const weights = [...new Set(base.weights.map((weight) => nearestWeight(weight, available)))].sort((a, b) => a - b);
    return { family: choice.family, source: "google", weights, italic: false };
  };
  const accentChoice = owner?.accent;
  let accent: FontSlot | null = design.accent ? { ...design.accent, weights: [...design.accent.weights] } : null;
  if (accentChoice === null) accent = null;
  else if (accentChoice) {
    accent = resolve(design.accent ?? { family: accentChoice.family, source: accentChoice.source, weights: [400], italic: false }, accentChoice);
  }
  const resolved: FontSlots = {
    display: resolve(design.display, owner?.display),
    body: resolve(design.body, owner?.body),
    accent,
  };
  // #4453 — the label face is the design's alone (owners cannot change it yet).
  if (design.label) resolved.label = { ...design.label, weights: [...design.label.weights] };
  return resolved;
}

const GENERIC: Readonly<Record<string, string>> = {
  serif: '"Times New Roman", Georgia, serif',
  "sans-serif": "ui-sans-serif, system-ui, -apple-system, \"Segoe UI\", sans-serif",
  display: "ui-sans-serif, system-ui, sans-serif",
  handwriting: "cursive",
  monospace: "ui-monospace, monospace",
};

/** The CSS font-family value for a slot: the family, its metric fallback, then a generic stack. */
export function fontStack(slot: FontSlot, category: string | null): string {
  if (!isFontFamilyName(slot.family)) return GENERIC["sans-serif"]!;
  const generic = GENERIC[category ?? "sans-serif"] ?? GENERIC["sans-serif"]!;
  if (slot.source === "system") return `"${slot.family}", ${generic}`;
  return `"${slot.family}", "${slot.family} Fallback", ${generic}`;
}
