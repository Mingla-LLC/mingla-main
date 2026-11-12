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
          // The last step may run on into prose ("Payments & Bank. The…").
          add(
            part.replace(NAV_LEADS, "").split(/\s+(?:and|to|then|or|\()\s*/)[0],
          );
        }
      }
    }
    for (
      const match of howTo.matchAll(
        /\b(?:tap|open|choose|select|go\s+to|then)\s+(?:the\s+)?([A-Z][^,.;:()\n"“”]{0,40}?)(?=\s+(?:to|and|then|tab|button|on|in|from|for|or|at|under|with)\b|[,.;:(]|$)/g,
      )
    ) {
      add(match[1]);
    }
  }
  knownLabels = labels;
  return labels;
}

function isKnownLabel(raw: string, extra: ReadonlySet<string>): boolean {
  const label = normaliseNavLabel(raw);
  if (!label) return false;
  const known = ariKnownNavLabels();
  return labelVariants(label).some((item) =>
    known.has(item) || extra.has(item)
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

/** A chain's steps are known: the first may carry its verb, the last its prose. */
function stepsKnown(steps: string[], extra: ReadonlySet<string>): boolean {
  return steps.every((raw, index) => {
    let step = raw.trim();
    if (index === 0) step = step.replace(NAV_LEADS, "");
    if (isKnownLabel(step, extra)) return true;
    const words = step.replace(/[*"“”]/g, " ").trim().split(/\s+/);
    if (index === 0) {
      // "Open the Hub" style: a known label at the end of the first step.
      for (let start = 1; start < words.length; start++) {
        if (isKnownLabel(words.slice(start).join(" "), extra)) return true;
      }
    }
    if (index === steps.length - 1) {
      // "Scanners on the event page": a known label, then prose.
      for (let end = words.length - 1; end >= 1; end--) {
        if (
          PROSE_WORD.test(words[end]) &&
          isKnownLabel(words.slice(0, end).join(" "), extra)
        ) return true;
      }
    }
    return false;
  });
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
  for (const match of String(text ?? "").matchAll(CHAIN)) {
    const steps = match[0].split(CHAIN_SEPARATOR);
    // A comparison or number ("price > 1000") is not a path.
    if (steps.some((step) => /^\s*[\d₦£$€]/.test(step))) continue;
    out.push({ path: match[0], known: stepsKnown(steps, extra) });
  }
  for (const match of String(text ?? "").matchAll(AND_TAP_CHAIN)) {
    out.push({
      path: match[0],
      known: stepsKnown([match[1], match[2]], extra),
    });
  }
  for (const match of String(text ?? "").matchAll(THEN_CHAIN)) {
    out.push({
      path: match[0],
      known: stepsKnown([match[1], match[2]], extra),
    });
  }
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
