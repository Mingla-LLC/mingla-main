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
      if (!NOT_A_SOURCE.test(host)) ownedHosts.push(host);
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

/** Visible words only; scripts, styles and comments are not the page speaking. */
function visibleText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function hrefs(html: string): string[] {
  return [...html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi)]
    .map((match) => match[1].replace(/&amp;/gi, "&").trim());
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
  if (
    identity.ownedHosts.some((owned) =>
      host === owned || host.endsWith(`.${owned}`)
    )
  ) return "owned_domain";
  const links = hrefs(page.html);
  for (const { host: socialHost, handle } of identity.handles) {
    const linked = links.some((link) => {
      const linkHost = hostOf(link);
      if (linkHost !== socialHost) return false;
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
  const name = normalizeWords(identity.name);
  const segments = page.title.split(/\s[|–—:·-]\s|\s[|–—·]|[|–—·]\s/)
    .map(normalizeWords).filter(Boolean);
  const hostLabel = host.split(".")[0].replace(/[^a-z0-9]/g, "");
  const nameMatches = segments.includes(name) ||
    hostLabel === name.replace(/\s+/g, "");
  if (!nameMatches) return null;
  return hasWholePhrase(visibleText(page.html), identity.city)
    ? "name_city"
    : null;
}

function jsonLdObjects(html: string): Json[] {
  const found: Json[] = [];
  for (
    const match of html.matchAll(
      /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    )
  ) {
    try {
      const parsed = JSON.parse(match[1]);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const entry of list) {
        const row = object(entry);
        found.push(row);
        if (Array.isArray(row["@graph"])) {
          for (const inner of row["@graph"]) found.push(object(inner));
        }
      }
    } catch {
      // Broken structured data is simply not evidence.
    }
  }
  return found;
}

const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i;
const EMAIL_IN_TEXT = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const NOT_A_CONTACT =
  /^(no-?reply|do-?not-?reply|postmaster|abuse|webmaster|privacy|legal|sentry)@|\.(png|jpe?g|gif|webp|svg)$|@(sentry\.|example\.|wixpress\.)/i;

function cleanValue(value: string): string {
  return sanitizeAriPublicText(value).text.replace(/\s+/g, " ").trim();
}

function emailsOf(
  html: string,
  pageHost: string,
  structured: Json[],
): string[] {
  const out = new Set<string>();
  for (const href of hrefs(html)) {
    if (!/^mailto:/i.test(href)) continue;
    const value = decodeURIComponent(href.slice(7).split("?")[0]).trim();
    if (EMAIL.test(value)) out.add(value.toLowerCase());
  }
  for (const row of structured) {
    const value = text(row.email)?.replace(/^mailto:/i, "");
    if (value && EMAIL.test(value)) out.add(value.toLowerCase());
  }
  // Loose text only counts on the page's own domain: this is what stops an
  // address planted in a page's wording from being offered at all.
  for (const match of visibleText(html).matchAll(EMAIL_IN_TEXT)) {
    const value = match[0].toLowerCase();
    const domain = value.split("@")[1];
    if (pageHost === domain || pageHost.endsWith(`.${domain}`)) out.add(value);
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
    if (/^tel:/i.test(href)) add(decodeURIComponent(href.slice(4)));
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
    const list = values.map(candidate).filter((row) => row.value.length > 0);
    if (list.length > 0) out[key] = list;
  };
  set("contact_email", emailsOf(page.html, pageHost, structured));
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
  const title = cleanValue(
    /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "",
  ).slice(0, 180);
  return { url: url.toString(), title, html };
}

export type ResearchStatus = "found" | "nothing" | "unavailable";

export interface ResearchRunDeps {
  search(query: string): Promise<AriResearchResult>;
  fetchPage(url: string): Promise<ResearchPage | null>;
  now(): string;
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
  while (queue.length > 0 && pagesRead < MAX_PAGES) {
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
    const basis = pageBelongsToBrand(identity, page);
    if (!basis) continue;
    found.push(extractCandidates({ page, basis, observedAt: deps.now() }));
    // Contact details usually sit one click away, on the brand's own host.
    const contact = hrefs(page.html).find((href) =>
      /^(\/|https:\/\/)/.test(href) && /\/(contact|about)\b/i.test(href)
    );
    if (contact && pagesRead < MAX_PAGES) {
      try {
        const absolute = new URL(contact, page.url);
        if (hostOf(absolute.toString()) === hostOf(page.url)) {
          queue.unshift(absolute.toString());
        }
      } catch {
        // A malformed link is skipped.
      }
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
  let claim: Json | null = null;
  try {
    const answer = await withTimeout(
      Promise.resolve(args.service.rpc("ari_brand_research_claim", {
        p_user_id: args.userId,
        p_brand_id: args.brandId,
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
      });
    });
    (args.schedule ?? inBackground)(work);
    return null;
  }
  return claim.status === "found"
    ? object(claim.candidates) as ResearchCandidates
    : null;
}
