/**
 * Issue #2830 — Ari's public research for brand details during Website setup.
 *
 * One search per brand plus one retry (ari_brand_research_claim), run in the
 * background so the question Ari is asking is never held up. Results wait in
 * `ari_brand_setup_research` and become evidence only at the moment Ari asks
 * that field, through the one existing path (ari_record_brand_context_finding),
 * then the owner's "Use this" goes through the normal protected proposal.
 * Nothing here writes `brands`.
 *
 * Page text is data. No model ever reads a page in this path: values are lifted
 * deterministically from `mailto:` / `tel:` links, structured data and same-host
 * text, so an instruction inside a page has nothing to act on.
 *
 * A wrong-brand suggestion is the worst outcome, so a candidate needs evidence
 * the page belongs to this brand, and when unsure this offers nothing:
 *   - owned_domain: the page is on the brand's own saved website; or
 *   - handle: the page links to a social profile the brand already saved; or
 *   - name_city: the page title has the brand's exact name as a whole segment
 *     (or its host is the name) and the page names the brand's city.
 * Directories and social networks are never sources.
 *
 * MINGLA-INVARIANT: I-ARI-RESEARCH-SAME-BRAND-ONLY | issue #2830 | A research candidate is offered only with evidence the page belongs to this brand, and never saves without the owner's explicit answer. Pinned by supabase/functions/_shared/__tests__/issue_2830_ari_brand_research.implementor.test.ts.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  assertSafePublicUrl,
  type AriResearchResult,
  fetchPublicUrl,
  searchPublicWeb,
} from "./agentWebResearch.ts";
import { sanitizeAriPublicText } from "./agentSanitization.ts";
import { structuredLog } from "./structuredLog.ts";
import { parsePhoneEntry } from "../../../packages/phone-input/phoneNumber.ts";
import {
  isResearchField,
  RESEARCH_FIELD_KEYS,
  type ResearchFieldKey,
  researchSourceLine,
} from "./ariBrandResearchCopy.ts";

export { isResearchField, RESEARCH_FIELD_KEYS, researchSourceLine };
export type { ResearchFieldKey };

/** The exact shape ari_record_brand_context_finding accepts. */
export interface ResearchCandidate {
  value: string;
  source_type: "public_research";
  source_ref: string;
  source_url: string;
  observed_at: string;
  confidence: number;
}
export type ResearchCandidates = Partial<
  Record<ResearchFieldKey, ResearchCandidate[]>
>;

export interface BrandIdentity {
  brandId: string;
  name: string;
  city: string | null;
  ownedHosts: string[];
  handles: { host: string; handle: string }[];
}

type Json = Record<string, unknown>;
const object = (value: unknown): Json =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Json
    : {};
const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const SOCIAL_HOSTS: Readonly<Record<string, string>> = Object.freeze({
  "instagram.com": "instagram",
  "tiktok.com": "tiktok",
  "x.com": "x",
  "twitter.com": "x",
  "facebook.com": "facebook",
  "youtube.com": "youtube",
  "linkedin.com": "linkedin",
  "threads.net": "threads",
});

/** Never a source of facts about a brand: anyone can appear on these. */
const NOT_A_SOURCE =
  /(^|\.)(facebook|instagram|tiktok|twitter|x|linkedin|youtube|threads|google|bing|duckduckgo|wikipedia|yelp|tripadvisor|eventbrite|meetup|foursquare|opentable|resy|posh|partiful|usemingla|mingla|yellowpages|mapquest|booking|airbnb|expedia|pinterest|reddit|medium)\.[a-z.]+$/i;

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeWords(value: string): string {
  return value.toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function hasWholePhrase(haystack: string, phrase: string): boolean {
  const words = normalizeWords(phrase);
  return words.length > 0 && ` ${normalizeWords(haystack)} `.includes(` ${words} `);
}

/** Who this brand is, from what Mingla already holds. Null: nothing to anchor on. */
export function brandIdentityFromPlan(
  brandId: string,
  plan: Json,
): BrandIdentity | null {
  const fields = Array.isArray(object(plan.completeness).fields)
    ? (object(plan.completeness).fields as unknown[]).map(object)
    : [];
  const field = (key: string) => fields.find((row) => row.key === key) ?? {};
  const name = text(field("name").value);
  if (!name) return null;
  const city = text(object(field("city_country").value).city);
  const links = object(object(field("social_links").value).social_links);
  const ownedHosts: string[] = [];
  const handles: { host: string; handle: string }[] = [];
  for (const [key, raw] of Object.entries(links)) {
    const url = text(raw);
    if (!url) continue;
    const host = hostOf(url);
    if (!host) continue;
    if (key === "website") {
      if (!NOT_A_SOURCE.test(host) && !isSharedHost(host)) ownedHosts.push(host);
      continue;
    }
    if (!SOCIAL_HOSTS[host]) continue;
    try {
      const handle = new URL(url).pathname.split("/").filter(Boolean)[0]
        ?.replace(/^@/, "").toLowerCase();
      if (handle) handles.push({ host, handle });
    } catch {
      // A malformed saved link anchors nothing.
    }
  }
  if (!city && ownedHosts.length === 0 && handles.length === 0) return null;
  return { brandId, name, city, ownedHosts, handles };
}

/** Who a search was for: a rename or a move makes its result someone else's. */
export function researchIdentity(identity: BrandIdentity): string {
  return `${normalizeWords(identity.name)}|${
    normalizeWords(identity.city ?? "")
  }`.slice(0, 400);
}

export function researchQuery(identity: BrandIdentity): string {
  return [
    `"${identity.name}"`,
    identity.city ?? "",
    "official website contact email phone address",
  ].filter(Boolean).join(" ");
}

export interface ResearchPage {
  url: string;
  title: string;
  html: string;
}

/**
 * Hard limit on what is ever parsed. Everything below scans once, with no regex
 * that can backtrack across the page: a hostile page costs linear time, bounded
 * by this, and never blocks the worker.
 */
export const PARSE_MAX_CHARS = 200_000;
const TAG_MAX_CHARS = 4_096;
const MAX_LINKS = 2_000;
const MAX_JSON_LD = 20;
const JSON_LD_MAX_CHARS = 100_000;

interface Scan {
  html: string;
  lower: string;
}

function scanOf(html: string): Scan {
  const bounded = html.length > PARSE_MAX_CHARS
    ? html.slice(0, PARSE_MAX_CHARS)
    : html;
  return { html: bounded, lower: bounded.toLowerCase() };
}

/** Next `>` at or after `from`, remembered so runs of `<` stay linear. */
function closer(scan: Scan): (from: number) => number {
  let cached = -2;
  return (from) => {
    if (cached === -1 || cached >= from) return cached;
    cached = scan.lower.indexOf(">", from);
    return cached;
  };
}

const SKIPPED_ELEMENTS = ["script", "style", "noscript"];

/** Visible words only; scripts, styles and comments are not the page speaking. */
function visibleText(source: string): string {
  const scan = scanOf(source);
  const { html, lower } = scan;
  const nextClose = closer(scan);
  const out: string[] = [];
  let at = 0;
  while (at < html.length) {
    const open = lower.indexOf("<", at);
    if (open < 0) {
      out.push(html.slice(at));
      break;
    }
    out.push(html.slice(at, open), " ");
    if (lower.startsWith("<!--", open)) {
      const end = lower.indexOf("-->", open + 4);
      if (end < 0) break;
      at = end + 3;
      continue;
    }
    const element = SKIPPED_ELEMENTS.find((name) =>
      lower.startsWith(name, open + 1)
    );
    if (element) {
      const end = lower.indexOf(`</${element}`, open + 1);
      if (end < 0) break;
      at = end + element.length + 2;
      continue;
    }
    const close = nextClose(open);
    // A bare `<`, or no real tag here: step over this one character.
    at = close >= 0 && close - open <= TAG_MAX_CHARS ? close + 1 : open + 1;
  }
  return out.join("").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ").trim();
}

function hrefs(source: string): string[] {
  const scan = scanOf(source);
  const { html, lower } = scan;
  const nextClose = closer(scan);
  const out: string[] = [];
  let at = 0;
  while (out.length < MAX_LINKS) {
    const open = lower.indexOf("<a", at);
    if (open < 0) break;
    at = open + 2;
    const after = lower.charCodeAt(open + 2);
    if (after !== 32 && after !== 9 && after !== 10 && after !== 13) continue;
    const close = nextClose(open);
    if (close < 0) break;
    if (close - open > TAG_MAX_CHARS) continue;
    const tag = html.slice(open, close);
    const match = /\shref\s{0,8}=\s{0,8}(?:"([^"]*)"|'([^']*)')/i.exec(tag);
    const value = match?.[1] ?? match?.[2];
    if (value) out.push(value.replace(/&amp;/gi, "&").trim());
    at = close + 1;
  }
  return out;
}

/** The body of each `<script type="application/ld+json">`, bounded. */
function jsonLdBodies(source: string): string[] {
  const scan = scanOf(source);
  const { html, lower } = scan;
  const out: string[] = [];
  let at = 0;
  while (out.length < MAX_JSON_LD) {
    const open = lower.indexOf("<script", at);
    if (open < 0) break;
    const close = lower.indexOf(">", open);
    if (close < 0) break;
    const end = lower.indexOf("</script", close);
    if (end < 0) break;
    at = end + 8;
    if (close - open > TAG_MAX_CHARS || end - close > JSON_LD_MAX_CHARS) continue;
    if (lower.slice(open, close).includes("application/ld+json")) {
      out.push(html.slice(close + 1, end));
    }
  }
  return out;
}

function safeDecode(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Hosts where anyone can have a page: never evidence of owning a domain. */
const SHARED_HOSTS = [
  "linktr.ee", "beacons.ai", "bio.site", "bio.link", "lnk.bio", "taplink.cc",
  "solo.to", "campsite.bio", "milkshake.app", "carrd.co", "wixsite.com",
  "wix.com", "weebly.com", "webflow.io", "framer.website", "framer.app",
  "notion.site", "sites.google.com", "github.io", "gitlab.io", "netlify.app",
  "vercel.app", "pages.dev", "web.app", "firebaseapp.com", "wordpress.com",
  "blogspot.com", "tumblr.com", "substack.com", "myshopify.com",
  "squarespace.com", "godaddysites.com", "canva.site", "my.canva.site",
];

export function isSharedHost(host: string): boolean {
  return SHARED_HOSTS.some((shared) =>
    host === shared || host.endsWith(`.${shared}`)
  );
}

export type SameBrandBasis = "owned_domain" | "handle" | "name_city";

/**
 * The same-brand guard. Exact name is a whole title segment: "Lantern Room Cafe
 * | Lagos" and "The Lantern Rooms" are other businesses, and they get nothing.
 */
export function pageBelongsToBrand(
  identity: BrandIdentity,
  page: ResearchPage,
): SameBrandBasis | null {
  const host = hostOf(page.url);
  if (!host || NOT_A_SOURCE.test(host)) return null;
  const shared = isSharedHost(host);
  if (
    !shared && identity.ownedHosts.some((owned) =>
      !isSharedHost(owned) && (host === owned || host.endsWith(`.${owned}`))
    )
  ) return "owned_domain";
  const name = normalizeWords(identity.name);
  const segments = page.title.split(/\s[|–—:·-]\s|\s[|–—·]|[|–—·]\s/)
    .map(normalizeWords).filter(Boolean);
  const hostLabel = shared ? "" : host.split(".")[0].replace(/[^a-z0-9]/g, "");
  const nameMatches = segments.includes(name) ||
    hostLabel === name.replace(/\s+/g, "");
  // Anyone can link to a brand or print its name. Neither alone says the page is
  // the brand's: a blog that links to the handle has an editor's email on it.
  if (!nameMatches) return null;
  const links = hrefs(page.html);
  for (const { host: socialHost, handle } of identity.handles) {
    const linked = links.some((link) => {
      if (hostOf(link) !== socialHost) return false;
      try {
        return new URL(link).pathname.split("/").filter(Boolean)[0]
          ?.replace(/^@/, "").toLowerCase() === handle;
      } catch {
        return false;
      }
    });
    if (linked) return "handle";
  }
  if (!identity.city) return null;
  // One common word needs more than a passing mention of the city ("we ship to
  // London, Paris and Lagos"): it must be where the page says it is.
  if (name.includes(" ")) {
    return hasWholePhrase(visibleText(page.html), identity.city)
      ? "name_city"
      : null;
  }
  const located = jsonLdObjects(page.html).some((row) => {
    const locality = text(object(row.address).addressLocality);
    return locality !== null && hasWholePhrase(locality, identity.city!);
  }) || segments.some((segment) => hasWholePhrase(segment, identity.city!));
  return located ? "name_city" : null;
}

function jsonLdObjects(html: string): Json[] {
  const found: Json[] = [];
  for (const body of jsonLdBodies(html)) {
    try {
      const parsed = JSON.parse(body);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of list.slice(0, 50)) {
        const row = object(entry);
        found.push(row);
        if (Array.isArray(row["@graph"])) {
          for (const inner of row["@graph"].slice(0, 50)) {
            found.push(object(inner));
          }
        }
      }
    } catch {
      // Broken structured data is simply not evidence.
    }
  }
  return found;
}

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;
const NOT_A_CONTACT =
  /^(no-?reply|do-?not-?reply|postmaster|abuse|webmaster|privacy|legal|sentry)@|\.(png|jpe?g|gif|webp|svg)$|@(sentry\.|example\.|wixpress\.)/i;

function cleanValue(value: string): string {
  return sanitizeAriPublicText(value.slice(0, 1_000)).text.replace(/\s+/g, " ")
    .trim();
}

/** Words a page wrote at Ari, not a fact about a brand. Offered as nothing. */
const INSTRUCTION_LIKE =
  /\b(?:ignore|disregard|instructions?|prompt|system|assistant|save this|bank account|password|approve|publish)\b/i;

const EMAIL_LOCAL = /[a-z0-9._%+-]/i;
const EMAIL_DOMAIN = /[a-z0-9.-]/i;

/** Addresses in loose text, by walking out from each `@`. Linear, bounded. */
function emailsInText(words: string): string[] {
  const out: string[] = [];
  let at = words.indexOf("@");
  while (at >= 0 && out.length < 200) {
    let start = at;
    while (start > 0 && at - start < 64 && EMAIL_LOCAL.test(words[start - 1])) start -= 1;
    let end = at + 1;
    while (end < words.length && end - at < 255 && EMAIL_DOMAIN.test(words[end])) end += 1;
    const value = words.slice(start, end).replace(/\.+$/, "").toLowerCase();
    if (EMAIL.test(value)) out.push(value);
    at = words.indexOf("@", end);
  }
  return out;
}

function emailsOf(
  html: string,
  pageHost: string,
  structured: Json[],
  basis: SameBrandBasis,
): string[] {
  const onDomain = (value: string) => {
    const domain = value.split("@")[1] ?? "";
    return pageHost === domain || pageHost.endsWith(`.${domain}`);
  };
  const out = new Set<string>();
  for (const href of hrefs(html)) {
    if (!/^mailto:/i.test(href)) continue;
    const value = safeDecode(href.slice(7).split("?")[0])?.trim();
    if (!value || !EMAIL.test(value)) continue;
    // A mail link off the page's domain is believed only on a page proven to be
    // the brand's; a name and a city are not proof enough for someone's gmail.
    if (basis === "name_city" && !onDomain(value.toLowerCase())) continue;
    out.add(value.toLowerCase());
  }
  // Structured data and loose words anyone can plant: the page's own domain only.
  for (const row of structured) {
    const value = text(row.email)?.replace(/^mailto:/i, "")?.toLowerCase();
    if (value && EMAIL.test(value) && onDomain(value)) out.add(value);
  }
  for (const value of emailsInText(visibleText(html))) {
    if (onDomain(value)) out.add(value);
  }
  return [...out].filter((value) => !NOT_A_CONTACT.test(value));
}

function phonesOf(html: string, structured: Json[]): string[] {
  const out = new Set<string>();
  const add = (raw: string | null) => {
    if (!raw) return;
    const compact = raw.replace(/[\s().-]/g, "");
    if (!/^\+[1-9][0-9]{7,14}$/.test(compact)) return;
    if (parsePhoneEntry(compact, { mode: "any" }).ok) out.add(compact);
  };
  for (const href of hrefs(html)) {
    if (/^tel:/i.test(href)) add(safeDecode(href.slice(4)));
  }
  for (const row of structured) add(text(row.telephone));
  return [...out];
}

function addressesOf(structured: Json[]): {
  street: string[];
  city: string[];
} {
  const street = new Set<string>();
  const city = new Set<string>();
  for (const row of structured) {
    const address = object(row.address);
    const locality = text(address.addressLocality);
    const country = text(object(address.addressCountry).name) ??
      text(address.addressCountry);
    const streetLine = text(address.streetAddress);
    if (streetLine) {
      street.add(
        [streetLine, locality].filter(Boolean).join(", ").slice(0, 240),
      );
    }
    if (locality && country) city.add(`${locality}, ${country}`.slice(0, 160));
  }
  return { street: [...street], city: [...city] };
}

function socialLinksOf(html: string): string[] {
  const out = new Map<string, string>();
  for (const href of hrefs(html)) {
    const host = hostOf(href);
    const platform = host ? SOCIAL_HOSTS[host] : undefined;
    if (!platform || out.has(platform) || !/^https:\/\//i.test(href)) continue;
    try {
      const url = new URL(href);
      const parts = url.pathname.split("/").filter(Boolean);
      // A profile, never a share button or one post.
      if (
        parts.length !== 1 ||
        /^(share|sharer|intent|hashtag|search|p|reel|watch|home|login)$/i.test(
          parts[0],
        )
      ) continue;
      out.set(platform, `https://${url.host}/${parts[0]}`);
    } catch {
      // Not a usable link.
    }
  }
  return [...out.values()];
}

/** What one same-brand page says, lifted as data. */
export function extractCandidates(args: {
  page: ResearchPage;
  basis: SameBrandBasis;
  observedAt: string;
}): ResearchCandidates {
  const { page, basis, observedAt } = args;
  const pageHost = hostOf(page.url) ?? "";
  // public_research evidence must be https (table check). Anything else drops.
  if (!page.url.startsWith("https://") || !pageHost) return {};
  const structured = jsonLdObjects(page.html);
  const candidate = (value: string): ResearchCandidate => ({
    value: cleanValue(value),
    source_type: "public_research",
    source_ref: `research:${basis}:${pageHost}`.slice(0, 300),
    source_url: page.url.slice(0, 1000),
    observed_at: observedAt,
    confidence: basis === "owned_domain" ? 0.9 : basis === "handle" ? 0.8 : 0.7,
  });
  const { street, city } = addressesOf(structured);
  const out: ResearchCandidates = {};
  const set = (key: ResearchFieldKey, values: string[]) => {
    const list = values.map(candidate).filter((row) =>
      row.value.length > 0 && row.value.length <= 240 &&
      !INSTRUCTION_LIKE.test(row.value)
    );
    if (list.length > 0) out[key] = list;
  };
  set("contact_email", emailsOf(page.html, pageHost, structured, basis));
  set("contact_phone", phonesOf(page.html, structured));
  set("address", street);
  set("city_country", city);
  const socials = socialLinksOf(page.html);
  if (socials.length > 0) set("social_links", socials);
  return out;
}

/**
 * One value per field, or nothing. Two different emails is "unsure", so neither
 * is offered. Links may differ only by platform, and only the first is offered:
 * the card asks about one at a time.
 */
export function mergeCandidates(all: ResearchCandidates[]): ResearchCandidates {
  const out: ResearchCandidates = {};
  for (const key of RESEARCH_FIELD_KEYS) {
    const rows = all.flatMap((entry) => entry[key] ?? []);
    if (rows.length === 0) continue;
    const distinct = new Map<string, ResearchCandidate>();
    for (const row of rows) {
      const id = row.value.toLowerCase();
      if (!distinct.has(id)) distinct.set(id, row);
    }
    if (key === "social_links") {
      out[key] = [[...distinct.values()][0]];
      continue;
    }
    if (distinct.size === 1) out[key] = [[...distinct.values()][0]];
  }
  return out;
}

const PAGE_TIMEOUT_MS = 6_000;
const PAGE_MAX_BYTES = 700_000;
const SEARCH_TIMEOUT_MS = 20_000;
const MAX_PAGES = 4;
/** After the search: no new page is read past this. A page is 6 s at most. */
const RUN_MAX_MS = 30_000;
/**
 * Parsing time across the whole run. A worst-case page parses in under a
 * second on a loaded machine; past this budget the run keeps what it found and
 * reads no more, so four hostile pages can't approach the function's CPU limit.
 */
export const PARSE_BUDGET_MS = 1_500;

async function fetchResearchPage(rawUrl: string): Promise<ResearchPage | null> {
  const signal = AbortSignal.timeout(PAGE_TIMEOUT_MS);
  const { url, response } = await fetchPublicUrl(assertSafePublicUrl(rawUrl), {
    method: "GET",
    accept: "text/html",
    userAgent: "Mingla-Ari-Research/1.0",
    timeoutMs: PAGE_TIMEOUT_MS,
    maxRedirects: 3,
    signal,
  });
  if (!response.ok) return null;
  const type = (response.headers.get("content-type") ?? "").split(";")[0]
    .toLowerCase();
  if (type !== "text/html") return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > PAGE_MAX_BYTES) return null;
  const html = new TextDecoder().decode(bytes);
  return { url: url.toString(), title: pageTitle(html), html };
}

/** The first `<title>`, found by scanning, never a regex across the page. */
export function pageTitle(html: string): string {
  const { html: bounded, lower } = scanOf(html);
  const open = lower.indexOf("<title");
  if (open < 0) return "";
  const start = lower.indexOf(">", open);
  const end = start < 0 ? -1 : lower.indexOf("</title", start);
  if (end < 0) return "";
  return cleanValue(bounded.slice(start + 1, Math.min(end, start + 1_000)))
    .slice(0, 180);
}

export type ResearchStatus = "found" | "nothing" | "unavailable";

export interface ResearchRunDeps {
  search(query: string): Promise<AriResearchResult>;
  fetchPage(url: string): Promise<ResearchPage | null>;
  now(): string;
  /** Milliseconds, for the parse budget. Defaults to performance.now. */
  clock?: () => number;
}

const PRODUCTION_DEPS: ResearchRunDeps = {
  search: searchPublicWeb,
  fetchPage: fetchResearchPage,
  now: () => new Date().toISOString(),
};

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: number | undefined;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error("RESEARCH_TIMEOUT")), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/** "Nothing" is an answer; a provider being down is not (it may retry once). */
function isNothingFound(error: unknown): boolean {
  return error instanceof Error && error.message === "RESEARCH_UNGROUNDED";
}

/**
 * The search plus page reads. Never throws. Provider outage is `unavailable`;
 * no same-brand page or nothing usable on one is `nothing`.
 */
export async function runBrandResearch(
  identity: BrandIdentity,
  deps: ResearchRunDeps = PRODUCTION_DEPS,
): Promise<{
  status: ResearchStatus;
  candidates: ResearchCandidates;
  pages_read: number;
  usage: AriResearchResult["usage"] | null;
}> {
  const urls: string[] = identity.ownedHosts.map((host) => `https://${host}/`);
  let usage: AriResearchResult["usage"] | null = null;
  try {
    const result = await withTimeout(
      deps.search(researchQuery(identity)),
      SEARCH_TIMEOUT_MS,
    );
    usage = result.usage ?? null;
    for (const source of result.sources) {
      if (!urls.includes(source.url)) urls.push(source.url);
    }
  } catch (error) {
    if (!isNothingFound(error) && urls.length === 0) {
      return { status: "unavailable", candidates: {}, pages_read: 0, usage };
    }
  }
  const found: ResearchCandidates[] = [];
  let pagesRead = 0;
  const queue = urls.slice(0, MAX_PAGES);
  const seen = new Set<string>();
  const deadline = Date.now() + RUN_MAX_MS;
  const clock = deps.clock ?? (() => performance.now());
  let parseMs = 0;
  while (
    queue.length > 0 && pagesRead < MAX_PAGES && Date.now() < deadline &&
    parseMs < PARSE_BUDGET_MS
  ) {
    const next = queue.shift()!;
    if (seen.has(next)) continue;
    seen.add(next);
    let page: ResearchPage | null = null;
    try {
      page = await deps.fetchPage(next);
    } catch {
      // An unreachable or blocked page is simply not evidence.
    }
    pagesRead += 1;
    if (!page) continue;
    // One bad page or value costs that page, never the run.
    const parseStarted = clock();
    try {
      const basis = pageBelongsToBrand(identity, page);
      if (!basis) continue;
      found.push(extractCandidates({ page, basis, observedAt: deps.now() }));
      // Contact details usually sit one click away, on the brand's own host.
      const contact = hrefs(page.html).find((href) =>
        /^(\/|https:\/\/)/.test(href) && /\/(contact|about)\b/i.test(href)
      );
      if (contact && pagesRead < MAX_PAGES) {
        const absolute = new URL(contact, page.url);
        if (hostOf(absolute.toString()) === hostOf(page.url)) {
          queue.unshift(absolute.toString());
        }
      }
    } catch (_error) {
      continue;
    } finally {
      parseMs += clock() - parseStarted;
    }
  }
  const candidates = mergeCandidates(found);
  return {
    status: Object.keys(candidates).length > 0 ? "found" : "nothing",
    candidates,
    pages_read: pagesRead,
    usage,
  };
}

/** Run after the response; falls back to a detached promise outside the edge runtime. */
function inBackground(work: Promise<unknown>): void {
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (runtime?.waitUntil) runtime.waitUntil(work);
}

export interface PrepareResearchArgs {
  service: SupabaseClient;
  userId: string;
  brandId: string;
  plan: Json;
  /** Test seams. */
  deps?: ResearchRunDeps;
  schedule?: (work: Promise<unknown>) => void;
  claimTimeoutMs?: number;
}

/**
 * Called while Ari prepares a brand-details question. Answers quickly with any
 * candidates already found, and starts the search in the background if it is
 * due. Null: ask the plain question (not allowed, nothing yet, or anything
 * failed). It must never hold the question up, so the claim is time-boxed too.
 */
export async function prepareBrandResearch(
  args: PrepareResearchArgs,
): Promise<ResearchCandidates | null> {
  // Only someone allowed to edit the brand; the RPC checks it again.
  if (args.plan.can_manage !== true) return null;
  const fields = Array.isArray(object(args.plan.completeness).fields)
    ? (object(args.plan.completeness).fields as unknown[]).map(object)
    : [];
  const open = fields.some((field) =>
    typeof field.key === "string" && isResearchField(field.key) &&
    field.requirement !== "optional" && field.state === "missing"
  );
  if (!open) return null;
  const identity = brandIdentityFromPlan(args.brandId, args.plan);
  if (!identity) return null;
  const fingerprint = researchIdentity(identity);
  let claim: Json | null = null;
  try {
    const answer = await withTimeout(
      Promise.resolve(args.service.rpc("ari_brand_research_claim", {
        p_user_id: args.userId,
        p_brand_id: args.brandId,
        p_identity: fingerprint,
      })),
      args.claimTimeoutMs ?? 800,
    ) as { data: unknown; error: unknown };
    if (answer.error) return null;
    claim = object(answer.data);
  } catch {
    return null;
  }
  if (claim.allowed === true) {
    const attempt = typeof claim.attempts === "number" ? claim.attempts : 1;
    const started = Date.now();
    const work = (async () => {
      const result = await runBrandResearch(identity, args.deps);
      // Spend signal: the Gemini call itself is in api_health_observations
      // (recordApiCall). This line ties it to a brand, attempt and outcome.
      structuredLog("info", "ari_setup_research", {
        brand_id: args.brandId,
        attempt,
        status: result.status,
        pages_read: result.pages_read,
        fields_found: Object.keys(result.candidates),
        latency_ms: Date.now() - started,
        prompt_tokens: result.usage?.prompt_tokens ?? null,
        output_tokens: result.usage?.output_tokens ?? null,
        total_tokens: result.usage?.total_tokens ?? null,
      });
      await args.service.rpc("ari_brand_research_finish", {
        p_brand_id: args.brandId,
        p_status: result.status,
        p_candidates: result.candidates,
        p_identity: fingerprint,
      });
    })().catch((error) => {
      structuredLog("warn", "ari_setup_research_failed", {
        brand_id: args.brandId,
        attempt,
        error: error instanceof Error ? error.message : "unknown",
      });
      // A crash counts as unavailable, so the retry rule still holds.
      return args.service.rpc("ari_brand_research_finish", {
        p_brand_id: args.brandId,
        p_status: "unavailable",
        p_candidates: {},
        p_identity: fingerprint,
      });
    });
    (args.schedule ?? inBackground)(work);
    // Empty, not null: what the old name found must not be offered this time.
    return claim.cleared === true ? {} : null;
  }
  if (claim.cleared === true) return {};
  return claim.status === "found"
    ? object(claim.candidates) as ResearchCandidates
    : null;
}
