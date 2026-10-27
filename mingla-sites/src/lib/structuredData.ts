import type { ArtifactV2 } from "../contracts/generated/artifactV2.ts";
import { isLiveOfferingGrid } from "../contracts/generated/blocks.ts";
import { selectGridOfferings, type OfferingGridConfig, type SiteOffering } from "../contracts/generated/offerings.ts";
import { richTextPlain } from "../contracts/generated/richText.ts";
import { isSafeHref } from "../contracts/generated/safety.ts";
import type { LiveOfferings } from "./offeringCards";
import { navigablePages, type ArtifactPage } from "./pageRouting";
import { canonicalUrl, pageDescription, socialImage } from "./seo";
import type { CollectionEntry } from "./siteCollections";

/*
 * #2829 W10 — schema.org structured data for one page, built ONLY from the
 * published artifact and Mingla's live feed (never from text that could carry
 * markup: every value is a plain string or number, and the serializer escapes
 * anything that could close the script element).
 *
 *   Organization + WebSite  every page
 *   BreadcrumbList          nested pages (two or more levels) and destination/story pages
 *   FAQPage                 a page with a questions block
 *   Article                 a story page
 *   Event                   each upcoming or running trip or event a live grid on the page shows;
 *                           `url` and `offers.url` are the existing Mingla offering page
 *                           (amendment A1.2: the site never hosts an offering page or a checkout)
 */
type JsonLd = Record<string, unknown>;

function abs(url: string | null | undefined, origin: string): string | undefined {
  if (!url || !isSafeHref(url)) return undefined;
  try {
    const resolved = new URL(url, `${origin}/`);
    return resolved.protocol === "https:" || resolved.protocol === "http:" ? resolved.toString() : undefined;
  } catch {
    return undefined;
  }
}

function organizationId(origin: string): string {
  return `${origin}/#organization`;
}

function organization(artifact: ArtifactV2, origin: string): JsonLd {
  const sameAs = (artifact.footer.socials ?? []).map((social) => social.url).filter((url) => url.startsWith("https://"));
  const logo = abs(artifact.brand.logo?.url, origin);
  return {
    "@type": "Organization",
    "@id": organizationId(origin),
    name: artifact.brand.display_name,
    url: `${origin}/`,
    ...(logo ? { logo } : {}),
    ...(artifact.brand.short_description ? { description: artifact.brand.short_description } : {}),
    ...(artifact.footer.email ? { email: artifact.footer.email } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  };
}

function website(artifact: ArtifactV2, origin: string): JsonLd {
  return {
    "@type": "WebSite",
    "@id": `${origin}/#website`,
    name: artifact.brand.display_name,
    url: `${origin}/`,
    inLanguage: artifact.language,
    publisher: { "@id": organizationId(origin) },
  };
}

/** Home, every ancestor that is a page of its own, then this page. */
function breadcrumbs(artifact: ArtifactV2, page: ArtifactPage, origin: string, entry?: CollectionEntry): JsonLd | null {
  const segments = page.path.split("/").filter(Boolean);
  if (!entry && segments.length < 2) return null;
  const pages = navigablePages(artifact);
  const trail: Array<{ name: string; url: string }> = [];
  const home = pages.find((candidate) => candidate.isHome);
  trail.push({ name: home?.title || "Home", url: `${origin}/` });
  for (let depth = 1; depth < segments.length; depth += 1) {
    const ancestor = pages.find((candidate) => candidate.path === segments.slice(0, depth).join("/"));
    if (ancestor) trail.push({ name: ancestor.title, url: canonicalUrl(ancestor, origin) });
  }
  if (entry && segments.length === 1) {
    // A story at the site root: its collection page stands in for the parent.
    const index = pages.find((candidate) => candidate.kind === "collection_index" && candidate.collection === entry.collection);
    if (index) trail.push({ name: index.title, url: canonicalUrl(index, origin) });
  }
  trail.push({ name: page.title, url: canonicalUrl(page, origin) });
  return {
    "@type": "BreadcrumbList",
    itemListElement: trail.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

function faq(page: ArtifactPage): JsonLd | null {
  const questions: JsonLd[] = [];
  for (const block of page.blocks as unknown as Array<{ type?: string; items?: Array<{ question?: unknown; answer?: unknown }> }>) {
    if (block.type !== "faq" || !Array.isArray(block.items)) continue;
    for (const item of block.items) {
      if (typeof item.question !== "string" || typeof item.answer !== "string") continue;
      questions.push({
        "@type": "Question",
        name: item.question,
        acceptedAnswer: { "@type": "Answer", text: item.answer },
      });
    }
  }
  return questions.length ? { "@type": "FAQPage", mainEntity: questions } : null;
}

function article(artifact: ArtifactV2, page: ArtifactPage, entry: CollectionEntry, origin: string): JsonLd | null {
  if (entry.collection !== "stories") return null;
  const story = entry.entry;
  const image = socialImage(artifact, page, origin, entry);
  const description = pageDescription(artifact, page, entry);
  const words = richTextPlain(story.content).split(/\s+/).filter(Boolean).length;
  return {
    "@type": "Article",
    headline: story.title.slice(0, 110),
    datePublished: story.published_at,
    mainEntityOfPage: canonicalUrl(page, origin),
    url: canonicalUrl(page, origin),
    ...(image ? { image: [image.url] } : {}),
    ...(description ? { description } : {}),
    ...(words ? { wordCount: words } : {}),
    inLanguage: artifact.language,
    author: { "@type": "Organization", name: artifact.brand.display_name, url: `${origin}/` },
    publisher: { "@id": organizationId(origin) },
  };
}

/** Minor units → a decimal string in the currency's own precision (JPY 0, USD 2, …). */
export function majorAmount(minor: number, currency: string): string | null {
  try {
    const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
    return (minor / 10 ** digits).toFixed(digits);
  } catch {
    return null;
  }
}

function offer(offering: SiteOffering, soldOut: boolean): JsonLd {
  const currency = offering.currency && /^[A-Z]{3}$/.test(offering.currency) ? offering.currency : null;
  let price: string | null = null;
  if (currency && typeof offering.min_price_minor === "number") price = majorAmount(offering.min_price_minor, currency);
  else if (currency && offering.has_free_tier) price = majorAmount(0, currency);
  return {
    "@type": "Offer",
    url: offering.public_url,
    availability: soldOut ? "https://schema.org/SoldOut" : "https://schema.org/InStock",
    // No price is ever guessed: a missing one is left out.
    ...(price !== null && currency ? { price, priceCurrency: currency } : {}),
  };
}

function events(artifact: ArtifactV2, page: ArtifactPage, live: LiveOfferings | undefined, origin: string): JsonLd[] {
  if (!live) return [];
  const seen = new Set<string>();
  const out: JsonLd[] = [];
  for (const raw of page.blocks as unknown as Array<{ type: string; mode?: unknown } & Partial<OfferingGridConfig>>) {
    if (!isLiveOfferingGrid(raw) || raw.mode === "past") continue;
    const result = selectGridOfferings(live.offerings, raw as OfferingGridConfig, live.now, live.filters);
    if (result.kind !== "ok") continue;
    for (const { offering, state } of result.offerings) {
      if (seen.has(offering.id) || state.phase === "ended") continue;
      if ((offering.kind !== "trip" && offering.kind !== "event") || !offering.start_at) continue;
      seen.add(offering.id);
      const image = abs(live.cards.get(offering.id)?.coverUrl ?? null, origin);
      out.push({
        "@type": "Event",
        name: offering.title,
        startDate: offering.start_at,
        ...(offering.end_at ? { endDate: offering.end_at } : {}),
        eventStatus: state.cancelled ? "https://schema.org/EventCancelled" : "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        ...(offering.destination_text
          ? { location: { "@type": "Place", name: offering.destination_text, address: offering.destination_text } }
          : {}),
        ...(image ? { image: [image] } : {}),
        ...(offering.summary ? { description: offering.summary } : {}),
        url: offering.public_url,
        organizer: { "@type": "Organization", name: artifact.brand.display_name, url: `${origin}/` },
        offers: offer(offering, state.soldOut),
      });
    }
  }
  return out;
}

export function pageStructuredData(input: {
  artifact: ArtifactV2;
  page: ArtifactPage;
  entry?: CollectionEntry;
  live?: LiveOfferings;
  /** `https://<current main address>` */
  origin: string;
}): JsonLd {
  const { artifact, page, entry, live, origin } = input;
  const graph: JsonLd[] = [organization(artifact, origin), website(artifact, origin)];
  const trail = breadcrumbs(artifact, page, origin, entry);
  if (trail) graph.push(trail);
  if (!entry) {
    const questions = faq(page);
    if (questions) graph.push(questions);
    graph.push(...events(artifact, page, live, origin));
  } else {
    const story = article(artifact, page, entry, origin);
    if (story) graph.push(story);
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

/**
 * JSON for a `<script type="application/ld+json">`: `<`, `>`, `&` and the two
 * JavaScript line separators are escaped, so no value can end the element or
 * start markup, whatever the owner typed.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}
