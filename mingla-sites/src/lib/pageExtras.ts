import { blockReadsFeed } from "../contracts/generated/blocks.ts";
import type { SiteBinding } from "./coreGateway";
import { enquiryAvailability } from "./enquiryAvailability";
import { loadBooking } from "./bookingFeed";
import { blockReadsBooking } from "../contracts/generated/availability.ts";
import { loadLiveOfferings, offeringFilters, type LiveOfferings } from "./offeringCards";
import type { ArtifactPage } from "./pageRouting";
import type { CollectionEntry } from "./siteCollections";
import { isV2Artifact, type SiteArtifact } from "./siteArtifact";
import { formNoticeFrom, formStampSignature, type FormsContext } from "./siteForms";

/*
 * #2829 W4/W5 — what one request's page needs beyond its artifact, read only
 * when the page uses it, always for the site Core resolved for this host:
 *   - Mingla's live offerings (live grids, the trips-we've-run ledger, a
 *     destination's related trips, a review's linked trip);
 *   - the form stamp and, for a contact form, whether the brand takes
 *     messages (#4111's switch).
 */
export type PageExtras = { live?: LiveOfferings; forms?: FormsContext };

type Search = Record<string, string | string[] | undefined> | undefined;

function needsFeed(page: ArtifactPage, entry: CollectionEntry | undefined): boolean {
  if (entry) return entry.collection === "destinations" && (entry.entry.related_offering_ids?.length ?? 0) > 0;
  return page.blocks.some((block) => {
    const record = block as unknown as { type: string; mode?: unknown; from_collection?: unknown };
    return blockReadsFeed(record) || (record.type === "testimonials" && record.from_collection === true);
  });
}

export async function loadPageExtras(input: {
  site: SiteBinding;
  artifact: SiteArtifact;
  page: ArtifactPage;
  entry?: CollectionEntry;
  search: Search;
  preview?: boolean;
  /** #2829 W10 — a private share link (forms say they work once the site is live). */
  shared?: boolean;
  now?: () => number;
}): Promise<PageExtras> {
  const { artifact, page, entry, site } = input;
  if (!isV2Artifact(artifact)) return {};
  const types = new Set(page.blocks.map((block) => (block as unknown as { type: string }).type));
  // #4453 milestone 5 — the live booking facts ride with the live offerings
  // (both are Mingla's live data for this page); a page with a booking block
  // or bar also gets the feed (stay rooms, the sticky bar's "from").
  const readsBooking = !entry && page.blocks.some((block) => blockReadsBooking(block as unknown as Record<string, unknown>));
  const [feed, enquiries, booking] = await Promise.all([
    needsFeed(page, entry) || readsBooking ? loadLiveOfferings(site, artifact, offeringFilters(input.search)) : Promise.resolve(undefined),
    types.has("contact_form") && !input.preview ? enquiryAvailability(site) : Promise.resolve("unknown" as const),
    readsBooking ? loadBooking(site, artifact, page.blocks) : Promise.resolve(undefined),
  ]);
  const live = feed && booking ? { ...feed, booking } : feed;
  let forms: FormsContext | undefined;
  if (!entry && (types.has("contact_form") || types.has("newsletter_signup"))) {
    const renderedAt = (input.now ?? Date.now)();
    forms = {
      renderedAt,
      signature: await formStampSignature(site.site_id, renderedAt),
      enquiries,
      notice: input.preview ? null : formNoticeFrom(input.search),
      ...(input.preview ? { preview: true } : {}),
      ...(input.preview && input.shared ? { shared: true } : {}),
    };
  }
  return { ...(live ? { live } : {}), ...(forms ? { forms } : {}) };
}
