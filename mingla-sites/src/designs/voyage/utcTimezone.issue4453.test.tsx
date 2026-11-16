/*
 * #4453 SC-1.6 — a trip stored in UTC reaches the live offering grid on a
 * voyage Home page (it was silently dropped before the fix), and an offering
 * with a refused timezone is still shown.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { VoyagePage } from "./VoyagePage";
import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import { parseOfferingsFeed } from "../../contracts/generated/offerings.ts";
import { offeringCard, offeringFilters, type LiveOfferings } from "../../lib/offeringCards";
import { resolveSitePath, type ArtifactPage } from "../../lib/pageRouting";
import type { FormsContext } from "../../lib/siteForms";

const NOW = new Date("2026-10-26T12:00:00Z");
const forms = { renderedAt: 1_760_000_000_000, signature: "stamp", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;

const trip = (timezone: string) => ({
  id: "22222222-2222-4222-8222-222222222222",
  kind: "trip", slug: "ski-week", title: "Ski Week Fixture", summary: null, cover: null,
  destination_text: "Alps", start_at: "2027-01-10T08:00:00.000Z", end_at: "2027-01-17T08:00:00.000Z",
  timezone, status: "scheduled", bookings_closed: false, capacity: null, spots_left: null, group_minimum: null,
  min_price_minor: null, currency: null, has_free_tier: false,
  public_url: "https://host.usemingla.com/t/fixture-brand/ski-week",
  waitlist_enabled: false, installments_available: false,
});

async function renderHome(timezone: string) {
  const artifact = voyageSyntheticArtifact();
  const offerings = parseOfferingsFeed({
    generated_at: "2026-10-26T00:00:00.000Z",
    brand: { slug: "fixture-brand", currency: "USD", payment_rails: "stripe" },
    offerings: [trip(timezone)],
  }).offerings;
  const cards = new Map();
  for (const offering of offerings) cards.set(offering.id, await offeringCard(artifact.site_id, offering, NOW, "en"));
  const live: LiveOfferings = { source: "live", offerings, cards, now: NOW, filters: offeringFilters(undefined) };
  const resolved = resolveSitePath(artifact, "");
  const page = resolved.kind === "page" ? (resolved.page as ArtifactPage) : undefined;
  return renderToStaticMarkup(<VoyagePage artifact={artifact} page={page} live={live} forms={forms} nonce="n" notFound={false} />);
}

describe("#4453 UTC offering in the live grid", () => {
  it("renders one photo card and no empty message for a UTC trip", async () => {
    const html = await renderHome("UTC");
    expect(html).toContain("Ski Week Fixture");
    expect((html.match(/data-offering-kind="trip"/g) ?? []).length).toBe(1);
    expect(html).not.toContain("No upcoming trips right now");
  });
  it("still renders the trip when its timezone is a refused alias", async () => {
    const html = await renderHome("EST");
    expect(html).toContain("Ski Week Fixture");
    expect(html).not.toContain("No upcoming trips right now");
  });
});
