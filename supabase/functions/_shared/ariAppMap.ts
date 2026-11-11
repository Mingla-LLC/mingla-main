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
