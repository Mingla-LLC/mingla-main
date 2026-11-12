// Issue #3355 Wave B (B2) — the Host App Map at runtime.
//
// `generated/ariAppMap.json` is written by scripts/ari/build-app-map.mjs from
// mingla-business/app/** (a CI drift check keeps it current). Every route Ari
// hands a host (a flow card's handoff, a choice that opens a screen, the
// reply's handoff route, open_handoff) must match one of its patterns; one
// that does not is dropped and the reply says how to get there instead, in
// the Feature Guide's words when the map links one (I-ARI-HANDOFF-FIXABLE).

import APP_MAP from "./generated/ariAppMap.json" with { type: "json" };

export interface AriAppRoute {
  pattern: string;
  params: string[];
  title: string;
  title_source: string;
  file: string;
  capability_keys: string[];
}

interface AriAppMapFile {
  schema_version: number;
  routes: AriAppRoute[];
  guide_how_to: Record<string, string>;
}

const MAP = APP_MAP as AriAppMapFile;

export const ARI_APP_ROUTES: readonly AriAppRoute[] = Object.freeze(
  MAP.routes,
);

/** "/(tabs)/home?x=1" → ["home"]; "{brand_id}" templates count as values. */
function routeSegments(route: string): string[] | null {
  if (typeof route !== "string") return null;
  const trimmed = route.trim();
  // Only in-app paths: never a scheme, host or protocol-relative URL.
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) return null;
  if (/[\s\\]/.test(trimmed)) return null;
  const path = trimmed.split(/[?#]/)[0];
  return path.split("/").filter((segment) => segment.length > 0)
    .filter((segment) => !/^\(.+\)$/.test(segment));
}

function patternSegments(pattern: string): string[] {
  return pattern.split("/").filter((segment) => segment.length > 0);
}

function segmentsMatch(route: string[], pattern: string[]): boolean {
  for (let index = 0; index < pattern.length; index++) {
    const expected = pattern[index];
    if (/^\[\.\.\.[A-Za-z0-9_]+\]$/.test(expected)) {
      return route.length > index; // a catch-all needs one or more segments
    }
    const actual = route[index];
    if (actual === undefined) return false;
    if (/^\[[A-Za-z0-9_]+\]$/.test(expected)) continue;
    if (actual !== expected) return false;
  }
  return route.length === pattern.length;
}

/** The App Map screen a route opens, or null when no Host screen matches. */
export function matchAriAppRoute(route: string): AriAppRoute | null {
  const segments = routeSegments(route);
  if (!segments) return null;
  // Static patterns win over dynamic ones ("/brand/new" before "/brand/[id]").
  const ranked = [...ARI_APP_ROUTES].sort((a, b) =>
    patternSegments(a.pattern).filter((s) => s.startsWith("[")).length -
    patternSegments(b.pattern).filter((s) => s.startsWith("[")).length
  );
  return ranked.find((entry) =>
    segmentsMatch(segments, patternSegments(entry.pattern))
  ) ?? null;
}

export function isAriAppRoute(route: string | null | undefined): boolean {
  return typeof route === "string" && matchAriAppRoute(route) !== null;
}

/** The Feature Guide how_to the App Map links to a screen, when it has one. */
export function ariGuideHowTo(capabilityKey: string): string | null {
  return Object.prototype.hasOwnProperty.call(MAP.guide_how_to, capabilityKey)
    ? MAP.guide_how_to[capabilityKey]
    : null;
}

/**
 * Words for a route Ari could not open: the Feature Guide how_to of the
 * mapped screen with that name (the card's route label), else a plain
 * pointer. Never a guessed screen.
 */
export function ariRouteFallbackText(
  _route: string,
  label?: string | null,
): string {
  const name = label?.trim() ?? "";
  if (name) {
    const screen = ARI_APP_ROUTES.find((entry) =>
      entry.title.toLowerCase() === name.toLowerCase() &&
      entry.capability_keys.length > 0
    );
    const howTo = screen ? ariGuideHowTo(screen.capability_keys[0]) : null;
    if (howTo) return howTo.split(/\n/)[0].trim();
    return `Open ${name} from the menu in Mingla Host.`;
  }
  return "Open it from the menu in Mingla Host.";
}

/** open_handoff's route: kept when the App Map has the screen, else how to get there. */
export function ariHandoffRoute(
  route: string,
  label?: string | null,
): { route: string } | { route: null; how_to: string } {
  return isAriAppRoute(route)
    ? { route }
    : { route: null, how_to: ariRouteFallbackText(route, label) };
}

interface RouteGuardOption {
  id: string;
  label: string;
  payload?: unknown;
  route?: string;
}

export interface AriRouteGuardResult<T> {
  value: T;
  dropped: string[];
}

/** A choices option whose handoff payload opens a route outside the map loses it. */
export function guardAriChoiceRoutes<T extends { options?: unknown }>(
  choices: T | undefined,
): AriRouteGuardResult<T | undefined> {
  if (!choices || !Array.isArray(choices.options)) {
    return { value: choices, dropped: [] };
  }
  const dropped: string[] = [];
  const options = (choices.options as RouteGuardOption[]).filter((option) => {
    const payload = option?.payload as
      | { type?: unknown; route?: unknown }
      | undefined;
    if (payload?.type !== "handoff") return true;
    if (typeof payload.route === "string" && isAriAppRoute(payload.route)) {
      return true;
    }
    dropped.push(String(payload.route ?? ""));
    return false;
  });
  return {
    value: dropped.length > 0 ? { ...choices, options } : choices,
    dropped,
  };
}

/** A flow card keeps only routes the App Map knows. */
export function guardAriArtefactRoutes<
  T extends {
    options?: RouteGuardOption[];
    handoff?: { route: string | null; route_label?: string } | null;
  },
>(artefact: T | null | undefined): AriRouteGuardResult<T | null | undefined> {
  if (!artefact) return { value: artefact, dropped: [] };
  const dropped: string[] = [];
  const options = (artefact.options ?? []).map((option) => {
    if (typeof option.route !== "string" || isAriAppRoute(option.route)) {
      return option;
    }
    dropped.push(option.route);
    const { route: _route, ...rest } = option;
    return rest as RouteGuardOption;
  });
  let handoff = artefact.handoff;
  if (
    handoff && typeof handoff.route === "string" &&
    !isAriAppRoute(handoff.route)
  ) {
    dropped.push(handoff.route);
    handoff = { ...handoff, route: null };
  }
  if (dropped.length === 0) return { value: artefact, dropped };
  return {
    value: {
      ...artefact,
      ...(artefact.options ? { options } : {}),
      ...(artefact.handoff !== undefined ? { handoff } : {}),
    },
    dropped,
  };
}

/**
 * The one runtime gate for a reply's routes (I-ARI-HANDOFF-FIXABLE): a route
 * outside the App Map is dropped and the reply text gains how to get there.
 */
export function guardAriReplyRoutes<
  C extends { options?: unknown } | undefined,
  A extends
    | {
      options?: RouteGuardOption[];
      handoff?: { route: string | null; route_label?: string } | null;
    }
    | null
    | undefined,
>(input: {
  text: string;
  handoffRoute?: string;
  choices?: C;
  flowArtefact?: A;
}): {
  text: string;
  handoffRoute?: string;
  choices?: C;
  flowArtefact?: A;
  dropped: string[];
} {
  const dropped: string[] = [];
  let handoffRoute = input.handoffRoute;
  if (handoffRoute !== undefined && !isAriAppRoute(handoffRoute)) {
    dropped.push(handoffRoute);
    handoffRoute = undefined;
  }
  const choices = guardAriChoiceRoutes(input.choices);
  dropped.push(...choices.dropped);
  const artefact = guardAriArtefactRoutes(input.flowArtefact);
  dropped.push(...artefact.dropped);
  let text = input.text;
  if (dropped.length > 0) {
    const label = input.flowArtefact?.handoff?.route_label ?? null;
    const fallback = ariRouteFallbackText(dropped[0], label);
    if (!text.includes(fallback)) text = `${text.trim()}\n\n${fallback}`.trim();
  }
  return {
    text,
    ...(handoffRoute !== undefined ? { handoffRoute } : {}),
    ...(input.choices !== undefined ? { choices: choices.value as C } : {}),
    ...(input.flowArtefact !== undefined
      ? { flowArtefact: artefact.value as A }
      : {}),
    dropped,
  };
}

// ── #3355 rework 9 (fix 7): screen paths in a reply are real ───────────────

/**
 * MINGLA-INVARIANT: I-ARI-PATHS-FROM-APP-MAP | issue #3355 | A navigation path in Ari's reply ("Manage > Scanners", "go to Account → Your brands", "tap "Guests" then "+"") is kept only when every step is a screen title of the generated App Map, a label the Feature Guide how_to names, or an object of this chat; otherwise the path's step (and the steps after it) is replaced by an honest pointer. Correct paths are never touched; prose, numbers and comparisons are not paths (enforced by supabase/functions/_shared/__tests__/issue_3355_rework_9.implementor.test.ts).
 */
export const ARI_UNKNOWN_PATH_SENTENCE =
  "I'm not sure where that is in Mingla Host — want me to ask the Mingla team?";

const LABEL_LEADS = /^(?:(?:the|your|a|an|my|its|their|this|that)\s+)+/i;
const LABEL_TAILS =
  /\s+(?:tab|tabs|screen|page|button|menu|tile|section|row|pill|option|link|icon|card|area|list|module|sheet|step)$/i;
const NAV_LEADS =
  /^(?:(?:then|and|next|first|now|just|simply|finally|also|please|or)\s+)*(?:(?:tap|tapping|open|opening|go\s+to|head\s+to|navigate\s+to|select|choose|click|press|find|visit|use|in|from|under|on|via|into|at)\s+)+/i;

/** A label as the map compares it: no quotes, articles or "tab". */
export function normaliseNavLabel(raw: string): string {
  let out = raw.replace(/[*_`"“”‘’]/g, "").replace(/'/g, "’").trim();
  out = out.replace(/[.,;:!?)(]+$/g, "").replace(/^[.,;:!?)(]+/g, "").trim();
  for (let index = 0; index < 3; index++) {
    const next = out.replace(LABEL_LEADS, "").replace(LABEL_TAILS, "").trim();
    if (next === out) break;
    out = next;
  }
  return out.replace(/\s+/g, " ").toLowerCase();
}

function labelVariants(label: string): string[] {
  const out = [label];
  if (label.endsWith("s")) out.push(label.slice(0, -1));
  else out.push(`${label}s`);
  return out;
}

const CHAIN_SEPARATOR = /\s*(?:->|→|›|»|>)\s*/;

let knownLabels: Set<string> | null = null;

/** Screen titles and Feature Guide labels, normalised, built once. */
export function ariKnownNavLabels(): ReadonlySet<string> {
  if (knownLabels) return knownLabels;
  const labels = new Set<string>([
    "mingla",
    "mingla host",
    "mingla host app",
    "host app",
    "the app",
    "app",
    "+",
  ]);
  const add = (raw: string) => {
    const label = normaliseNavLabel(raw);
    if (label && label.length <= 60) labels.add(label);
  };
  for (const route of ARI_APP_ROUTES) add(route.title);
  for (const howTo of Object.values(MAP.guide_how_to)) {
    for (const match of howTo.matchAll(/["“]([^"”\n]{1,60})["”]/g)) {
      add(match[1]);
    }
    for (const sentence of howTo.split(/[.;\n|]|\s\d+\)\s/)) {
      if (CHAIN_SEPARATOR.test(sentence) && /->|→|›|»|>/.test(sentence)) {
        for (const part of sentence.split(CHAIN_SEPARATOR)) {
          add(part.replace(NAV_LEADS, ""));
          // #3355 rework 10: "Staff open Mingla Admin > …" names "Mingla Admin".
          add(
            part.replace(
              /^.*\b(?:open|tap|go\s+to|head\s+to|choose|select)\s+/i,
              "",
            ),
          );
          // The last step may run on into prose ("Payments & Bank. The…").
          add(
            part.replace(NAV_LEADS, "").split(/\s+(?:and|to|then|or|\()\s*/)[0],
          );
        }
      }
    }
    // #3355 rework 10: "the Menu tab", "the Payments screen" name a screen.
    for (
      const match of howTo.matchAll(
        /\b([A-Z][\p{L}&]*(?: (?:& )?[A-Z][\p{L}&]*){0,2})\s+(?:screen|tab|page|menu|section|tile)\b/gu,
      )
    ) {
      add(match[1]);
    }
    for (
      const match of howTo.matchAll(
        // #3355 rework 10: a sentence may start "Tap …" / "Open …".
        /\b(?:[Tt]ap|[Oo]pen|[Cc]hoose|[Ss]elect|[Gg]o\s+to|[Tt]hen)\s+(?:the\s+)?([A-Z][^,.;:()\n"“”]{0,40}?)(?=\s+(?:to|and|then|tab|button|on|in|from|for|or|at|under|with)\b|[,.;:(]|$)/g,
      )
    ) {
      add(match[1]);
    }
  }
  knownLabels = labels;
  return labels;
}

/** The known label a raw step names (its matching variant), or null. */
function knownLabelOf(
  raw: string,
  extra: ReadonlySet<string>,
): { label: string; extra: boolean } | null {
  const label = normaliseNavLabel(raw);
  if (!label) return null;
  const known = ariKnownNavLabels();
  for (const item of labelVariants(label)) {
    if (extra.has(item)) return { label: item, extra: true };
  }
  for (const item of labelVariants(label)) {
    if (known.has(item)) return { label: item, extra: false };
  }
  return null;
}

function isKnownLabel(raw: string, extra: ReadonlySet<string>): boolean {
  return knownLabelOf(raw, extra) !== null;
}

// ── #3355 rework 10: consecutive steps must be a real way through the app ──

/** Labels that lead anywhere ("Mingla Host > …", "… then +"). */
const GENERIC_NAV_LABELS: ReadonlySet<string> = new Set([
  "mingla",
  "mingla host",
  "mingla host app",
  "host app",
  "the app",
  "app",
  "+",
]);

let routesByLabel: Map<string, string[][]> | null = null;
let guideSteps: string[] | null = null;

/** Screen title (normalised) → the route patterns' segments with it. */
function routeSegmentsByLabel(): Map<string, string[][]> {
  if (routesByLabel) return routesByLabel;
  const map = new Map<string, string[][]>();
  for (const route of ARI_APP_ROUTES) {
    const label = normaliseNavLabel(route.title);
    if (!label) continue;
    const list = map.get(label) ?? [];
    list.push(patternSegments(route.pattern));
    map.set(label, list);
  }
  routesByLabel = map;
  return map;
}

/** Every Feature Guide how_to step (one line), normalised for matching. */
function featureGuideSteps(): string[] {
  if (guideSteps) return guideSteps;
  guideSteps = Object.values(MAP.guide_how_to).flatMap((howTo) =>
    howTo.split(/\n|\s\d+\)\s/)
  ).map((step) =>
    step.replace(/[*_`"“”‘’]/g, " ").replace(/'/g, "’").replace(/\s+/g, " ")
      .toLowerCase().trim()
  ).filter((step) => step.length > 0);
  return guideSteps;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const labelStepCache = new Map<string, ReadonlySet<number>>();

/** The how_to steps that name a label (whole words, any case). */
function guideStepsNaming(label: string): ReadonlySet<number> {
  const cached = labelStepCache.get(label);
  if (cached) return cached;
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapeRegExp(label)}(?:[^\\p{L}\\p{N}]|$)`,
    "u",
  );
  const out = new Set<number>();
  featureGuideSteps().forEach((step, index) => {
    if (pattern.test(step)) out.add(index);
  });
  labelStepCache.set(label, out);
  return out;
}

/**
 * "A > B" is a real way through the app: B's screen sits under A's in the
 * App Map, or one Feature Guide how_to step names both, or either is this
 * chat's own object or a generic "Mingla Host" / "+".
 */
function stepFollows(
  from: { label: string; extra: boolean },
  to: { label: string; extra: boolean },
): boolean {
  if (from.extra || to.extra) return true;
  if (from.label === to.label) return true;
  if (GENERIC_NAV_LABELS.has(from.label) || GENERIC_NAV_LABELS.has(to.label)) {
    return true;
  }
  const routes = routeSegmentsByLabel();
  const parents = labelVariants(from.label).flatMap((item) =>
    routes.get(item) ?? []
  );
  const children = labelVariants(to.label).flatMap((item) =>
    routes.get(item) ?? []
  );
  if (
    parents.some((parent) =>
      children.some((child) =>
        child.length >= parent.length &&
        parent.every((segment, index) => child[index] === segment)
      )
    )
  ) return true;
  const named = new Set(
    labelVariants(from.label).flatMap((item) => [...guideStepsNaming(item)]),
  );
  return labelVariants(to.label).some((item) =>
    [...guideStepsNaming(item)].some((index) => named.has(index))
  );
}

/** One step of a written path: quoted, bold, or Capitalised words. */
const STEP = String
  .raw`(?:\*\*[^*\n]{1,60}\*\*|["“][^"”\n]{1,60}["”]|\+|[\p{Lu}][\p{L}\p{N}&'’+\-]*(?:[ ](?:&[ ])?[\p{L}\p{N}&'’+\-]+){0,5})`;
const CHAIN = new RegExp(
  `${STEP}(?:\\s*(?:->|→|›|»|>)\\s*${STEP})+`,
  "gu",
);
const THEN_CHAIN = new RegExp(
  String
    .raw`\b(?:tap|open|go\s+to|select|choose|click)\s+(${STEP})\s*,?\s+(?:and\s+)?then\s+(?:tap\s+|open\s+|select\s+|choose\s+|click\s+|go\s+to\s+)?(${STEP})`,
  "giu",
);
/** "Go to the event's "Manage" screen and tap "Scanners"" (quoted steps). */
const AND_TAP_CHAIN = new RegExp(
  String
    .raw`\b(?:go\s+to|open|head\s+to)\s+(?:the\s+|your\s+)?(?:[\p{L}]+['’]s\s+)?(["“][^"”\n]{1,60}["”]|\*\*[^*\n]{1,60}\*\*)\s+(?:screen|page|tab|menu|section|area|tile)?\s*,?\s*(?:and|then)\s+(?:tap|choose|select|open|press|click)\s+(?:on\s+)?(["“][^"”\n]{1,60}["”]|\*\*[^*\n]{1,60}\*\*)`,
  "giu",
);
const PROSE_WORD =
  /^(?:on|in|to|and|then|for|at|with|from|under|of|or|if|when|so|which|where|inside|near|beside|next)$/i;

/** One step's known label: the first may carry its verb, the last its prose. */
function stepLabel(
  raw: string,
  index: number,
  count: number,
  extra: ReadonlySet<string>,
): { label: string; extra: boolean } | null {
  let step = raw.trim();
  if (index === 0) step = step.replace(NAV_LEADS, "");
  const whole = knownLabelOf(step, extra);
  if (whole) return whole;
  const words = step.replace(/[*"“”]/g, " ").trim().split(/\s+/);
  if (index === 0) {
    // "Open the Hub" style: a known label at the end of the first step.
    for (let start = 1; start < words.length; start++) {
      const found = knownLabelOf(words.slice(start).join(" "), extra);
      if (found) return found;
    }
  }
  if (index === count - 1) {
    // "Scanners on the event page": a known label, then prose.
    for (let end = words.length - 1; end >= 1; end--) {
      if (!PROSE_WORD.test(words[end])) continue;
      const found = knownLabelOf(words.slice(0, end).join(" "), extra);
      if (found) return found;
    }
  }
  return null;
}

/**
 * A chain's steps are known, and (#3355 rework 10) each step follows the
 * one before it in the App Map or a Feature Guide how_to step.
 */
function stepsKnown(steps: string[], extra: ReadonlySet<string>): boolean {
  const labels = steps.map((raw, index) =>
    stepLabel(raw, index, steps.length, extra)
  );
  if (labels.some((label) => label === null)) return false;
  for (let index = 1; index < labels.length; index++) {
    if (!stepFollows(labels[index - 1]!, labels[index]!)) return false;
  }
  return true;
}

// ── #3355 rework 10: paths in any case ──────────────────────────────────────

/**
 * Code spans, URLs, file paths and emails are masked (same length) before
 * paths are read: they are never navigation.
 */
function maskNonProse(text: string): string {
  const blank = (match: string) => "\u0001".repeat(match.length);
  return text
    .replace(/```[\s\S]*?```/g, blank)
    .replace(/`[^`\n]*`/g, blank)
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, blank)
    .replace(/\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/g, blank)
    .replace(/\b[\w-]+(?:\.[\w-]+)+(?:\/\S*)?/g, blank)
    .replace(/(?:^|(?<=\s))[\w.-]*(?:\/[\w.-]+){2,}\/?/g, blank)
    .replace(/(?:^|(?<=\s))\/[\w.-]\S*/g, blank);
}

/** One step in any case: quoted, bold, "+" or one to four plain words. */
const ANY_STEP = String
  .raw`(?:(?:(?:the|your)\s+)?(?:\*\*[^*\n]{1,60}\*\*|["“][^"”\n]{1,60}["”])|\+|[\p{L}][\p{L}\p{N}&'’+\-]*(?:[ ](?:&[ ])?[\p{L}\p{N}&'’+\-]+){0,3})`;
const ARROW_SEP = String.raw`\s*(?:->|→|›|»|>)\s*`;
const SLASH_SEP = String.raw`\s*\/\s*`;
const THEN_SEP = String
  .raw`\s*,?\s+(?:and\s+)?then\s+(?:(?:tap|open|go\s+to|head\s+to|select|choose|click|press)\s+(?:on\s+)?)?`;
/** A lead that says the words after it are a place in the app. */
const ANY_CASE_LEAD = String
  .raw`\b(go\s+(?:over\s+)?to|head\s+(?:over\s+)?to|navigate\s+to|open(?:\s+up)?|tap(?:\s+on)?|select|choose|click(?:\s+on)?|press|visit|in|under|via|from)\s+`;
const ANY_CASE_CHAIN = new RegExp(
  `${ANY_CASE_LEAD}(${ANY_STEP}(?:(?:${ARROW_SEP}|${SLASH_SEP}|${THEN_SEP})${ANY_STEP})+)`,
  "giu",
);
/**
 * "On the event's Manage screen", "go to the "Manage" tab": one named
 * screen in a navigation phrase (the rework 9 and 10 demos' invention).
 */
const NAMED_SCREEN = new RegExp(
  String
    .raw`\b(?:[Oo]n|[Oo]pen|[Gg]o\s+to|[Hh]ead\s+to|[Ss]witch\s+to|[Uu]nder|[Vv]ia|[Ff]rom)\s+(?:the\s+|your\s+)?(?:[\p{L}]+['’]s\s+)?(["“][^"”\n]{1,40}["”]|[\p{Lu}][\p{L}&]*(?:[ ](?:&[ ])?[\p{Lu}][\p{L}&]*){0,2})\s+(?:screen|tab|page|menu|section)\b`,
  "gu",
);
/** "> scanners > invite scanner": a line that opens with an arrow (live demo). */
const LINE_ARROW_CHAIN = new RegExp(
  String.raw`(?:^|\n)[ \t]*(?:(?:\d+[.)]|[-•*])\s+)?(?:->|→|›|»|>)\s*` +
    `(${ANY_STEP}(?:${ARROW_SEP}${ANY_STEP})+)`,
  "giu",
);
const ANY_CASE_SPLIT = new RegExp(
  `${ARROW_SEP}|${SLASH_SEP}|${THEN_SEP}`,
  "iu",
);
/** "in", "under", "via", "from" lead a path only with an arrow. */
const WEAK_LEAD = /^(?:in|under|via|from)$/i;
/** "and/or", "he/she": a slash between such words is not a path. */
const SLASH_WORDS =
  /\b(?:and|or|he|she|him|her|his|hers|they|them|yes|no|either|on|off)\s*\/\s*(?:and|or|he|she|him|her|his|hers|they|them|yes|no|neither|on|off)\b/i;

/**
 * #3355 rework 10: a lowercase (or mixed-case) path after a navigation lead
 * ("go to settings > scanners", "open manage → scanners", "head to hub, then
 * scanners"). Arrows and slashes are deliberate; a "then" chain is only a
 * path when it names two known screens or a quoted / "tab"-style step, so
 * prose ("open the doors, then greet guests") stays prose.
 */
function anyCasePaths(
  masked: string,
  source: string,
  extra: ReadonlySet<string>,
): Array<{ path: string; known: boolean }> {
  const out: Array<{ path: string; known: boolean }> = [];
  for (const match of masked.matchAll(ANY_CASE_CHAIN)) {
    const lead = match[1].replace(/\s+/g, " ").trim();
    const chain = match[2];
    const start = (match.index ?? 0) + match[0].length - chain.length;
    const path = source.slice(start, start + chain.length);
    const arrow = new RegExp(ARROW_SEP).test(chain);
    const slash = /\//.test(chain);
    if (WEAK_LEAD.test(lead) && !arrow) continue;
    if (slash && !arrow && SLASH_WORDS.test(chain)) continue;
    const steps = path.split(ANY_CASE_SPLIT).filter((step) => step.trim());
    if (steps.length < 2) continue;
    if (steps.some((step) => /^\s*[\d₦£$€]/.test(step))) continue;
    if (!arrow && !slash && !thenChainIsNavigation(steps, extra)) continue;
    out.push({ path, known: stepsKnown(steps, extra) });
  }
  for (const match of masked.matchAll(NAMED_SCREEN)) {
    const path = source.slice(
      match.index ?? 0,
      (match.index ?? 0) + match[0].length,
    );
    out.push({ path, known: stepLabel(match[1], 1, 2, extra) !== null });
  }
  for (const match of masked.matchAll(LINE_ARROW_CHAIN)) {
    const chain = match[1];
    const start = (match.index ?? 0) + match[0].length - chain.length;
    const path = source.slice(start, start + chain.length);
    const steps = path.split(new RegExp(ARROW_SEP, "u"));
    if (steps.some((step) => /^\s*[\d₦£$€]/.test(step))) continue;
    out.push({ path, known: stepsKnown(steps, extra) });
  }
  return out;
}

/**
 * #3355 rework 10: a "then" chain with no arrow is navigation only when two
 * of its steps are known screens or one is quoted, bold or "… tab"-style;
 * "open the doors, then greet the guests" and "go to Lagos then Abuja" are
 * prose.
 */
function thenChainIsNavigation(
  steps: readonly string[],
  extra: ReadonlySet<string>,
): boolean {
  const labelled =
    steps.filter((step, index) =>
      stepLabel(step, index, steps.length, extra) !== null
    ).length;
  const marked = steps.some((step) =>
    /["“*]/.test(step) || LABEL_TAILS.test(step.trim())
  );
  return labelled >= 2 || marked;
}

/** Every path written in the text, and whether each is real. */
export function navigationPathsIn(
  text: string,
  extraLabels: readonly string[] = [],
): Array<{ path: string; known: boolean }> {
  const extra = new Set(
    extraLabels.flatMap((label) => labelVariants(normaliseNavLabel(label))),
  );
  const out: Array<{ path: string; known: boolean }> = [];
  const source = String(text ?? "");
  // Rework 10: code, URLs and file paths are never read as navigation.
  const masked = maskNonProse(source);
  const original = (match: RegExpMatchArray) =>
    source.slice(match.index ?? 0, (match.index ?? 0) + match[0].length);
  for (const match of masked.matchAll(CHAIN)) {
    const path = original(match);
    const steps = path.split(CHAIN_SEPARATOR);
    // A comparison or number ("price > 1000") is not a path.
    if (steps.some((step) => /^\s*[\d₦£$€]/.test(step))) continue;
    out.push({ path, known: stepsKnown(steps, extra) });
  }
  for (const match of masked.matchAll(AND_TAP_CHAIN)) {
    out.push({
      path: original(match),
      known: stepsKnown([match[1], match[2]], extra),
    });
  }
  for (const match of masked.matchAll(THEN_CHAIN)) {
    // Rework 10: prose with "then" is not a path.
    if (!thenChainIsNavigation([match[1], match[2]], extra)) continue;
    out.push({
      path: original(match),
      known: stepsKnown([match[1], match[2]], extra),
    });
  }
  out.push(...anyCasePaths(masked, source, extra));
  return out;
}

const LIST_ITEM = /^\s*(?:\d+[.)]|[-•*])\s+/;

/**
 * #3355 rework 9 (fix 7, I-ARI-PATHS-FROM-APP-MAP): a step with a screen
 * path the App Map and the Feature Guide do not know is replaced by
 * ARI_UNKNOWN_PATH_SENTENCE, once. In a numbered or bulleted list the steps
 * after it go too (they happen on that screen); an intro line ending in ":"
 * with nothing left under it goes as well. Known paths are never touched.
 */
export function guardReplyNavigation(
  text: string,
  extraLabels: readonly string[] = [],
): { text: string; removed: string[] } {
  const source = String(text ?? "");
  const unknown = navigationPathsIn(source, extraLabels).filter((item) =>
    !item.known
  );
  if (unknown.length === 0) return { text: source, removed: [] };
  const bad = (part: string) =>
    unknown.some((item) => part.includes(item.path));
  const lines = source.split("\n");
  const out: string[] = [];
  const removed: string[] = [];
  let said = false;
  let droppingList = false;
  const say = () => {
    if (!said) out.push(ARI_UNKNOWN_PATH_SENTENCE);
    said = true;
  };
  for (const line of lines) {
    const isItem = LIST_ITEM.test(line);
    if (droppingList) {
      if (isItem || (line.trim() && /^\s{2,}/.test(line))) {
        removed.push(line.trim());
        continue;
      }
      droppingList = false;
    }
    if (!bad(line)) {
      out.push(line);
      continue;
    }
    if (isItem) {
      removed.push(line.trim());
      droppingList = true;
      // The intro ("To add a scanner:") has no step left under it.
      let back = out.length - 1;
      while (back >= 0 && !out[back].trim()) back--;
      if (back >= 0 && /:\s*$/.test(out[back]) && !LIST_ITEM.test(out[back])) {
        removed.push(out[back].trim());
        out.splice(back, 1);
      } else if (back >= 0 && LIST_ITEM.test(out[back])) {
        // Earlier steps stay; the pointer follows them.
      }
      say();
      continue;
    }
    const kept: string[] = [];
    let replaced = false;
    for (const sentence of line.split(/(?<=[.!?])\s+(?=[A-Z“"*(\d])/)) {
      if (bad(sentence)) {
        removed.push(sentence.trim());
        if (!said && !replaced) kept.push(ARI_UNKNOWN_PATH_SENTENCE);
        said = true;
        replaced = true;
        continue;
      }
      kept.push(sentence);
    }
    if (kept.length > 0) out.push(kept.join(" "));
  }
  const joined = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: joined || ARI_UNKNOWN_PATH_SENTENCE, removed };
}
