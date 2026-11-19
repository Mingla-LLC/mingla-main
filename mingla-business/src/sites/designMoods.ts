/**
 * #4453 Website workspace — "Mood": one tap sets several look choices at
 * once (colours, corners, buttons, movement). The moods are DATA
 * (MOOD_PRESETS); what a mood means in one design is worked out from that
 * data and then proven readable: any pair of text and background the mood
 * would make hard to read is moved to the nearest readable shade with the
 * shared contrast helpers, and a mood whose colours cannot be made readable
 * in a design keeps that design's own colours (it still sets the shape).
 * So no mood can put unreadable text on a draft, in any design.
 */
import type { DesignDefinition } from "../../../packages/site-contracts/src/designs.ts";
import {
  RAMP_ROLES,
  resolveTokens,
  type OwnerTokenOverrides,
  type RampOverride,
  type RampRole,
  type ResolvedTokens,
} from "../../../packages/site-contracts/src/tokens.ts";
import {
  nearestPassingShade,
  READABILITY_PAIRS,
  readabilityWarnings,
  type ReadabilityWarning,
} from "../../../packages/site-contracts/src/readability.ts";

import { setSwatch, swatchWarnings } from "./siteLook";
import { designSwatches } from "../../../packages/site-contracts/src/designs.ts";

export const MOOD_KEYS = ["playful", "premium", "night"] as const;
export type MoodKey = (typeof MOOD_KEYS)[number];

type MoodColours = {
  canvas: string;
  surface_sunken: string;
  surface_deep: string;
  ink_strong: string;
  ink_body: string;
  accent: string;
  accent_ink: string;
  highlight: string;
};

export type MoodPreset = {
  key: MoodKey;
  label: string;
  /** What it does, for screen readers and the tooltip. */
  describes: string;
  colours: MoodColours;
  radius: NonNullable<OwnerTokenOverrides["radius"]>;
  button_shape: NonNullable<OwnerTokenOverrides["button_shape"]>;
  motion: NonNullable<OwnerTokenOverrides["motion"]>;
};

/* #4420 content: these hex values are the WEBSITE's colours an owner picks, not Host chrome. */
export const MOOD_PRESETS: Readonly<Record<MoodKey, MoodPreset>> = {
  playful: {
    key: "playful",
    label: "Playful",
    describes: "Warm cream, a bright accent, soft corners and lively movement",
    colours: { canvas: "#fff6e9", surface_sunken: "#ffe9c7", surface_deep: "#1b1736", ink_strong: "#1b1736", ink_body: "#2b2647", accent: "#ff6a1a", accent_ink: "#1b1736", highlight: "#c2185b" },
    radius: "soft",
    button_shape: "pill",
    motion: "lively",
  },
  premium: {
    key: "premium",
    label: "Premium",
    describes: "Clean white, a quiet gold accent, sharp corners and calm movement",
    colours: { canvas: "#ffffff", surface_sunken: "#f4f1ea", surface_deep: "#15130f", ink_strong: "#15130f", ink_body: "#3a362e", accent: "#b08a4a", accent_ink: "#15130f", highlight: "#6b5324" },
    radius: "sharp",
    button_shape: "square",
    motion: "calm",
  },
  night: {
    key: "night",
    label: "Night out",
    describes: "A dark page, a bright lime accent, round corners and lively movement",
    colours: { canvas: "#14121f", surface_sunken: "#1e1b2e", surface_deep: "#0b0a12", ink_strong: "#f6f1ff", ink_body: "#d9d3ea", accent: "#9fdc3c", accent_ink: "#14121f", highlight: "#7c5cff" },
    radius: "round",
    button_shape: "pill",
    motion: "lively",
  },
};

const isRamp = (role: string): role is RampRole => (RAMP_ROLES as readonly string[]).includes(role);

type Colours = Record<string, string | RampOverride>;

function withColour(colours: Colours, ref: string, hex: string): Colours {
  const [role, step] = ref.split(".") as [string, string | undefined];
  if (!isRamp(role)) return { ...colours, [role]: hex };
  const current = colours[role];
  const ramp: RampOverride = current && typeof current === "object" ? current : {};
  if (step === undefined) return { ...colours, [role]: { ...ramp, seed: hex as RampOverride["seed"] } };
  return { ...colours, [role]: { ...ramp, steps: { ...(ramp.steps ?? {}), [Number(step)]: hex } as RampOverride["steps"] } };
}

function moodOverrides(preset: MoodPreset, colours: Colours | null): OwnerTokenOverrides {
  return {
    ...(colours ? { colors: colours as OwnerTokenOverrides["colors"] } : {}),
    radius: preset.radius,
    button_shape: preset.button_shape,
    motion: preset.motion,
  };
}

function baseColours(preset: MoodPreset): Colours {
  const c = preset.colours;
  return {
    canvas: c.canvas,
    surface_sunken: c.surface_sunken,
    surface_deep: c.surface_deep,
    ink_strong: c.ink_strong,
    ink_body: c.ink_body,
    accent: { seed: c.accent as RampOverride["seed"], steps: { 400: c.accent } as RampOverride["steps"] },
    accent_ink: c.accent_ink,
    highlight: { seed: c.highlight as RampOverride["seed"] },
  };
}

/** One readable-shade fix for a failing pair: move the text; when the text is fixed white, move the background. */
function repairOne(colours: Colours, warning: ReadabilityWarning): Colours | null {
  const pair = READABILITY_PAIRS.find((entry) => entry.id === warning.pair);
  if (!pair) return null;
  if (pair.foreground === "white") {
    const shade = nearestPassingShade(warning.background, warning.foreground, warning.required);
    return shade ? withColour(colours, pair.background, shade) : null;
  }
  const shade = nearestPassingShade(warning.foreground, warning.background, warning.required);
  return shade ? withColour(colours, pair.foreground, shade) : null;
}

const MAX_REPAIR_PASSES = 8;

/**
 * The look a mood gives THIS design: the preset's colours and shape, with
 * every hard-to-read pair moved to a readable shade. `readable` is false only
 * when the colours could not be made readable, in which case they are left
 * out and the design keeps its own.
 */
export function moodFor(design: DesignDefinition, key: MoodKey): { tokens: OwnerTokenOverrides; resolved: ResolvedTokens; coloursApplied: boolean } {
  const preset = MOOD_PRESETS[key];
  let colours: Colours | null = baseColours(preset);
  for (let pass = 0; pass < MAX_REPAIR_PASSES && colours; pass += 1) {
    const warnings = safeWarnings(design, moodOverrides(preset, colours));
    if (warnings === null) {
      colours = null;
      break;
    }
    if (warnings.length === 0) break;
    let next: Colours | null = colours;
    for (const warning of warnings) {
      next = next ? repairOne(next, warning) : null;
      if (!next) break;
    }
    colours = next;
  }
  if (colours) {
    const left = safeWarnings(design, moodOverrides(preset, colours));
    if (left === null || left.length > 0) colours = null;
  }
  const tokens = moodOverrides(preset, colours);
  return { tokens, resolved: resolveTokens(design.tokens, tokens), coloursApplied: colours !== null };
}

function safeWarnings(design: DesignDefinition, tokens: OwnerTokenOverrides): ReadabilityWarning[] | null {
  try {
    return readabilityWarnings(resolveTokens(design.tokens, tokens));
  } catch {
    return null;
  }
}

/** The three moods for a design, ready to draw (label, swatches) and apply. */
export function moodsFor(design: DesignDefinition): { key: MoodKey; label: string; describes: string; tokens: OwnerTokenOverrides; swatches: [string, string, string]; coloursApplied: boolean }[] {
  return MOOD_KEYS.map((key) => {
    const preset = MOOD_PRESETS[key];
    const mood = moodFor(design, key);
    const colours = mood.resolved.colors as unknown as Record<string, unknown>;
    const accent = (colours.accent as Record<number, string> | undefined)?.[400];
    return {
      key,
      label: preset.label,
      describes: preset.describes,
      tokens: mood.tokens,
      swatches: [String(colours.canvas), String(accent ?? preset.colours.accent), String(colours.ink_strong)],
      coloursApplied: mood.coloursApplied,
    };
  });
}

const stable = (value: unknown): string => JSON.stringify(value, (_key, entry) =>
  entry && typeof entry === "object" && !Array.isArray(entry)
    ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
    : entry);

/** Which mood the current look is exactly (null: the owner has made it their own). */
export function activeMood(design: DesignDefinition, tokens: OwnerTokenOverrides): MoodKey | null {
  const current = stable({ ...tokens, heading_case: undefined });
  return MOOD_KEYS.find((key) => stable(moodFor(design, key).tokens) === current) ?? null;
}

/** Applying a mood keeps the owner's heading case (it is not part of a mood). */
export function applyMood(design: DesignDefinition, tokens: OwnerTokenOverrides, key: MoodKey): OwnerTokenOverrides {
  const mood = moodFor(design, key).tokens;
  return tokens.heading_case ? { ...mood, heading_case: tokens.heading_case } : mood;
}

/* ── The contrast guard ──────────────────────────────────────────────────── */
export type ContrastFix = {
  pair: string;
  /** "Button labels on your accent colour is hard to read (2.1:1)." */
  sentence: string;
  /** New overrides with the one readable shade applied; null when no shade passes. */
  fixed: OwnerTokenOverrides | null;
};

/**
 * Every hard-to-read pair in the look as it stands, each with a one-tap fix.
 * The same list blocks Publish, so the count here and the reason there can
 * never disagree.
 */
export function contrastFixes(design: DesignDefinition, tokens: OwnerTokenOverrides): ContrastFix[] {
  const warnings = safeWarnings(design, tokens) ?? [];
  return warnings.map((warning) => {
    const colours = repairOne({ ...((tokens.colors ?? {}) as Colours) }, warning);
    return {
      pair: warning.pair,
      sentence: `${warning.where} is hard to read (${warning.ratio.toFixed(1)}:1).`,
      fixed: colours ? { ...tokens, colors: colours as OwnerTokenOverrides["colors"] } : null,
    };
  });
}

/** Fix every pair at once (the guard's "Fix it"). Null when even that cannot make it readable. */
export function fixAllContrast(design: DesignDefinition, tokens: OwnerTokenOverrides): OwnerTokenOverrides | null {
  let current = tokens;
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass += 1) {
    const fixes = contrastFixes(design, current);
    if (fixes.length === 0) return current;
    const first = fixes.find((fix) => fix.fixed !== null);
    if (!first?.fixed) return null;
    current = first.fixed;
  }
  return contrastFixes(design, current).length === 0 ? current : null;
}

/* ── The guard on colours the design actually draws ──────────────────────── */
export type DrawnContrastIssue = { role: string; sentence: string; suggestion: string | null };

/**
 * Hard-to-read pairs among the colours THIS design draws, in the owner's
 * words, each with the nearest readable shade. This is the list the Design
 * panel shows and the list that blocks Publish.
 */
export function drawnContrastIssues(design: DesignDefinition, tokens: OwnerTokenOverrides): DrawnContrastIssue[] {
  let resolved: ResolvedTokens;
  try {
    resolved = resolveTokens(design.tokens, tokens);
  } catch {
    return [];
  }
  return [...swatchWarnings(design, resolved).entries()].map(([role, entry]) => ({
    role,
    sentence: `${entry.warning.where} is hard to read (${entry.warning.ratio.toFixed(1)}:1).`,
    suggestion: entry.suggestion,
  }));
}

/** One tap: every drawn pair moved to its nearest readable shade. Null when one has no readable shade. */
export function fixDrawnContrast(design: DesignDefinition, tokens: OwnerTokenOverrides): OwnerTokenOverrides | null {
  let current = tokens;
  const swatches = designSwatches(design);
  for (let pass = 0; pass < MAX_REPAIR_PASSES; pass += 1) {
    const issues = drawnContrastIssues(design, current);
    if (issues.length === 0) return current;
    const issue = issues[0]!;
    const swatch = swatches.find((entry) => entry.role === issue.role);
    const next = swatch && issue.suggestion ? setSwatch(current, swatch, issue.suggestion) : null;
    if (!next) return null;
    current = next;
  }
  return drawnContrastIssues(design, current).length === 0 ? current : null;
}

/**
 * How many hard-to-read pairs block Publish. Only the owner's own colour
 * choices can block: a design's untouched colours never do.
 */
export function publishBlockingPairs(design: DesignDefinition, tokens: OwnerTokenOverrides): number {
  if (!tokens.colors || Object.keys(tokens.colors).length === 0) return 0;
  return drawnContrastIssues(design, tokens).length;
}
