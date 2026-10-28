/**
 * #2829 AD-5 — page tree paths, collection base paths, per-site redirects and
 * the collision rule, named once for Studio, the publication builder and the
 * public runtime.
 *
 * A path is the page's address without the leading slash: "" is the home
 * page, "about", "resources/faqs". Every segment is a lowercase slug. The
 * runtime resolves a request in a fixed order (redirect → page by full path →
 * collection detail by base path → root-level story → not found), so two
 * things that would answer the same address can never both be published: the
 * builder refuses with PATH_COLLISION and the last good site stays live.
 */
import { MAX_PAGE_DEPTH, MAX_REDIRECTS, MAX_SLUG_LENGTH } from "./limits.ts";

/** First path segments the runtime owns; no page, base path or redirect may take one. */
export const RESERVED_FIRST_SEGMENTS = [
  "api",
  "media",
  "fonts",
  "om",
  "map",
  "preview",
  "book",
  "_next",
  "robots.txt",
  "sitemap.xml",
  ".well-known",
] as const;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const COLLECTION_KINDS = [
  "trips",
  "events",
  "experiences",
  "destinations",
  "stories",
] as const;
export type CollectionKind = (typeof COLLECTION_KINDS)[number];

export const PAGE_KINDS = ["standard", "collection_index"] as const;
export type PageKind = (typeof PAGE_KINDS)[number];

/** Where each collection's detail pages live. `stories: ""` = at the site root. */
export type SiteRoutes = Record<CollectionKind, string>;

export const DEFAULT_SITE_ROUTES: SiteRoutes = {
  trips: "trips",
  events: "events",
  experiences: "experiences",
  destinations: "destinations",
  stories: "stories",
};

export const REDIRECT_STATUSES = [301, 308] as const;
export type RedirectStatus = (typeof REDIRECT_STATUSES)[number];
export type RedirectRule = { from: string; to: string; status: RedirectStatus };

export function isCollectionKind(value: unknown): value is CollectionKind {
  return typeof value === "string" &&
    (COLLECTION_KINDS as readonly string[]).includes(value);
}

export function isSlug(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    value.length <= MAX_SLUG_LENGTH && SLUG_PATTERN.test(value);
}

export function isReservedSegment(segment: string): boolean {
  return (RESERVED_FIRST_SEGMENTS as readonly string[]).includes(segment);
}

/** "" (home) or 1..MAX_PAGE_DEPTH slug segments whose first is not reserved. */
export function isPagePath(value: unknown): value is string {
  if (value === "") return true;
  if (typeof value !== "string") return false;
  const segments = value.split("/");
  return segments.length <= MAX_PAGE_DEPTH &&
    segments.every(isSlug) &&
    !isReservedSegment(segments[0]!);
}

/** A collection base path: one slug, or "" (stories only). */
export function isBasePath(kind: CollectionKind, value: unknown): value is string {
  if (value === "") return kind === "stories";
  return isSlug(value) && !isReservedSegment(value as string);
}

export function isSiteRoutes(value: unknown): value is SiteRoutes {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).every((key) => isCollectionKind(key)) &&
    COLLECTION_KINDS.every((kind) => isBasePath(kind, record[kind]));
}

/** Owner input → routes, defaults filled in. Returns null on any invalid value. */
export function resolveSiteRoutes(input: Partial<Record<string, unknown>> | null | undefined): SiteRoutes | null {
  const routes = { ...DEFAULT_SITE_ROUTES } as Record<string, unknown>;
  for (const kind of COLLECTION_KINDS) {
    const value = input?.[kind];
    if (value !== undefined && value !== null) routes[kind] = value;
  }
  return isSiteRoutes(routes) ? (routes as SiteRoutes) : null;
}

/** "/" + path; home is "/". */
export function hrefForPath(path: string): string {
  return path === "" ? "/" : `/${path}`;
}

/**
 * The request's path segments as one normalised path, or null when the
 * request cannot name a page (bad segment, too deep is still allowed through
 * so collection details and redirects can match; only shape is checked).
 */
export function normalizeRequestSegments(segments: readonly string[] | undefined): string | null {
  const parts = (segments ?? []).filter((segment) => segment !== "");
  if (parts.length > 8) return null;
  for (const part of parts) {
    if (part.length > 200 || /[\u0000-\u001F\u007F/\\]/.test(part)) return null;
  }
  return parts.join("/");
}

/* ------------------------------------------------------------------ */
/* Redirects                                                            */
/* ------------------------------------------------------------------ */

const PARAM_SEGMENT = /^:([a-z][a-z0-9_]{0,31})(\*)?$/;

type CompiledRedirect = { rule: RedirectRule; regex: RegExp; names: string[] };

function compileFrom(from: string): { regex: RegExp; names: string[] } | null {
  if (!from.startsWith("/") || from.length > 200 || /[?#\s\\]/.test(from)) return null;
  const segments = from === "/" ? [] : from.slice(1).replace(/\/$/, "").split("/");
  if (!segments.length) return null; // redirecting the home page is not allowed
  const names: string[] = [];
  let pattern = "^";
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const param = PARAM_SEGMENT.exec(segment);
    if (param) {
      if (index === 0) return null; // the first segment is always literal
      if (names.includes(param[1]!)) return null;
      names.push(param[1]!);
      if (param[2]) {
        if (index !== segments.length - 1) return null; // :path* only last
        pattern += "(?:/(.*))?";
      } else {
        pattern += "/([^/]+)";
      }
      continue;
    }
    if (!isSlug(segment)) return null;
    if (index === 0 && isReservedSegment(segment)) return null;
    pattern += `/${segment}`;
  }
  return { regex: new RegExp(`${pattern}/?$`), names };
}

function isSafeRedirectTarget(to: string): boolean {
  if (to.length > 2048 || /[\u0000-\u001F\u007F\s\\]/.test(to)) return false;
  if (to.startsWith("/")) return !to.startsWith("//");
  try {
    const url = new URL(to);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Why a rule is invalid, or null when it is valid. */
export function redirectRuleProblem(rule: unknown): string | null {
  if (!rule || typeof rule !== "object" || Array.isArray(rule)) return "REDIRECT_SHAPE";
  const { from, to, status } = rule as Record<string, unknown>;
  if (typeof from !== "string" || typeof to !== "string") return "REDIRECT_SHAPE";
  if (!(REDIRECT_STATUSES as readonly unknown[]).includes(status)) return "REDIRECT_STATUS";
  const compiled = compileFrom(from);
  if (!compiled) return "REDIRECT_FROM";
  if (!isSafeRedirectTarget(to)) return "REDIRECT_TO";
  for (const match of to.matchAll(/:([a-z][a-z0-9_]{0,31})\*?/g)) {
    if (!to.startsWith("/") && match.index! < to.indexOf("/", 8)) continue; // https://host:port
    if (!compiled.names.includes(match[1]!)) return "REDIRECT_TO";
  }
  if (from.replace(/\/$/, "") === to.replace(/\/$/, "")) return "REDIRECT_LOOP";
  return null;
}

export function isRedirectRules(value: unknown): value is RedirectRule[] {
  return Array.isArray(value) && value.length <= MAX_REDIRECTS &&
    value.every((rule) => redirectRuleProblem(rule) === null);
}

export function compileRedirects(rules: readonly RedirectRule[]): CompiledRedirect[] {
  const compiled: CompiledRedirect[] = [];
  for (const rule of rules) {
    if (redirectRuleProblem(rule) !== null) continue;
    const from = compileFrom(rule.from)!;
    compiled.push({ rule, ...from });
  }
  return compiled;
}

/**
 * The first rule matching `pathname` (a request path starting with "/"), with
 * its target filled in, or null. Rules are tried in their stored order.
 */
export function matchRedirect(
  rules: readonly RedirectRule[] | readonly CompiledRedirect[],
  pathname: string,
): { location: string; status: RedirectStatus } | null {
  const compiled = (rules.length && "regex" in (rules[0] as object)
    ? rules
    : compileRedirects(rules as RedirectRule[])) as CompiledRedirect[];
  for (const entry of compiled) {
    const match = entry.regex.exec(pathname);
    if (!match) continue;
    const values: Record<string, string> = {};
    entry.names.forEach((name, index) => {
      values[name] = match[index + 1] ?? "";
    });
    let location = entry.rule.to.replace(
      /(^|\/):([a-z][a-z0-9_]{0,31})\*?/g,
      (whole, lead: string, name: string) =>
        name in values ? `${lead}${values[name]}` : whole,
    );
    location = location.replace(/\/{2,}/g, (run, offset: number) =>
      offset > 0 && location[offset - 1] === ":" ? run : "/"
    );
    if (location.length > 1) location = location.replace(/\/$/, "");
    return { location: location || "/", status: entry.rule.status };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Collisions                                                           */
/* ------------------------------------------------------------------ */

export type CollisionInput = {
  pages: ReadonlyArray<{ path: string }>;
  routes: SiteRoutes;
  redirects?: readonly RedirectRule[];
  /** Detail slugs per collection that the site will serve, when known. */
  collectionSlugs?: Partial<Record<CollectionKind, readonly string[]>>;
};

/**
 * Every address two different things would answer. Empty means publishable.
 * Each entry is a plain sentence naming the address, never field names.
 */
export function findPathCollisions(input: CollisionInput): string[] {
  const problems: string[] = [];
  const owners = new Map<string, string>();
  const claim = (path: string, owner: string) => {
    const existing = owners.get(path);
    if (existing && existing !== owner) {
      problems.push(`${hrefForPath(path)} is used by ${existing} and ${owner}`);
    } else owners.set(path, owner);
  };
  for (const page of input.pages) {
    if (!isPagePath(page.path)) {
      problems.push(`${hrefForPath(page.path)} is not an address a page can have`);
      continue;
    }
    if (owners.has(page.path)) {
      problems.push(`${hrefForPath(page.path)} is used by two pages`);
      continue;
    }
    owners.set(page.path, "a page");
  }
  const bases = new Map<string, CollectionKind>();
  for (const kind of COLLECTION_KINDS) {
    const base = input.routes[kind];
    if (!isBasePath(kind, base)) {
      problems.push(`the ${kind} address "${base}" is not allowed`);
      continue;
    }
    const other = bases.get(base);
    if (other !== undefined) {
      problems.push(`${hrefForPath(base)} is the address of both ${other} and ${kind}`);
    }
    bases.set(base, kind);
    for (const slug of input.collectionSlugs?.[kind] ?? []) {
      if (!isSlug(slug)) continue;
      claim(base === "" ? slug : `${base}/${slug}`, `the ${kind} entry "${slug}"`);
    }
  }
  for (const rule of input.redirects ?? []) {
    const literal = rule.from.replace(/^\//, "").replace(/\/$/, "");
    if (literal.includes(":")) continue;
    const owner = owners.get(literal);
    if (owner) problems.push(`${hrefForPath(literal)} redirects away, but ${owner} lives there`);
  }
  return [...new Set(problems)];
}
