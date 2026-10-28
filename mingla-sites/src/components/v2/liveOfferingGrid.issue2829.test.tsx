/*
 * #2829 W4 (SC-17, SC-18, A1.2) — a live offering grid on a site page:
 *  - every card links to the EXISTING Mingla public page (no site detail
 *    page, no site checkout, no /book);
 *  - upcoming shows price and "Book"; ended shows "Ended", no price, no Book;
 *    a picked cancelled trip says "Cancelled"; sold out offers the waitlist
 *    only when it is on; a missing price reads "Price on request";
 *  - covers come through the token-bound /om route; none is invented;
 *  - the snapshot renders the same way when Core is down;
 *  - an original v1 grid on the same design still renders its fixed list.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64") }) }));

import type { SiteOffering } from "../../contracts/generated/offerings.ts";
import { offeringCard, offeringFilters, type LiveOfferings } from "../../lib/offeringCards";
import { offeringMediaToken } from "../../lib/offeringMedia";
import { LiveOfferingGrid } from "./LiveOfferingGrid";
import { AtelierPage } from "../../designs/atelier/AtelierPage";
import { upgradeV1ToV2 } from "../../contracts/generated/upgradeV1ToV2.ts";
import { gogiV1Fixture } from "../../contracts/gogiV1.fixture";
import { sitePages } from "../../lib/pageRouting";

const SITE = "aaaaaaaa-1111-4111-8111-111111111111";
const context = { siteId: SITE, brandId: "bbbbbbbb-1111-4111-8111-111111111111", publicationId: "cccccccc-1111-4111-8111-111111111111" };
const NOW = new Date("2026-06-10T12:00:00Z");
let n = 0;
const make = (patch: Partial<SiteOffering>): SiteOffering => ({
  id: `11111111-1111-4111-8111-${String(++n).padStart(12, "0")}`,
  kind: "trip", slug: `trip-${n}`, title: `Trip ${n}`, summary: null, cover: null, destination_text: null,
  start_at: "2026-07-01T00:00:00Z", end_at: "2026-07-05T00:00:00Z", timezone: "Europe/Tirane", status: "scheduled",
  bookings_closed: false, capacity: 20, spots_left: 4, group_minimum: null, min_price_minor: 180000, currency: "USD",
  has_free_tier: false, public_url: `https://host.usemingla.com/t/youngandstamped/trip-${n}`, waitlist_enabled: false,
  installments_available: true, ...patch,
});

const upcoming = make({ title: "Albania", slug: "albania", public_url: "https://host.usemingla.com/t/youngandstamped/albania", cover: { path: "event_covers/ys/albania.jpg", type: "image" } });
const ended = make({ title: "Bali", slug: "bali", public_url: "https://host.usemingla.com/t/youngandstamped/bali", start_at: "2026-03-01T00:00:00Z", end_at: "2026-03-08T00:00:00Z" });
const cancelled = make({ title: "Peru", status: "cancelled" });
const soldOutWaitlist = make({ title: "Japan", spots_left: 0, waitlist_enabled: true });
const noPrice = make({ title: "Morocco", min_price_minor: null });
const all = [upcoming, ended, cancelled, soldOutWaitlist, noPrice];

async function live(offerings: SiteOffering[], source: "live" | "snapshot" = "live", search?: Record<string, string>): Promise<LiveOfferings> {
  const cards = new Map();
  for (const offering of offerings) cards.set(offering.id, await offeringCard(SITE, offering, NOW, "en"));
  return { source, offerings, cards, now: NOW, filters: offeringFilters(search) };
}

const render = async (block: Record<string, unknown>, data: LiveOfferings | undefined) =>
  renderToStaticMarkup(<LiveOfferingGrid block={block} live={data} context={context} clearHref="/trips" />);

function cardOf(html: string, title: string): string {
  const start = html.indexOf(`<h3>${title}</h3>`);
  const open = html.lastIndexOf("<article", start);
  return html.slice(open, html.indexOf("</article>", start));
}

describe("#2829 live offering grid", () => {
  it("links every card to the existing Mingla page and says Book only when bookable", async () => {
    const html = await render({ heading: "Trips", kind: "trip", mode: "all" }, await live(all));
    const albania = cardOf(html, "Albania");
    expect(albania).toContain('href="https://host.usemingla.com/t/youngandstamped/albania"');
    expect(albania).toContain(">Book<");
    expect(albania).toContain("From $1,800");
    expect(albania).toContain("July 1–5, 2026");
    expect(albania).toContain(`src="/om/${await offeringMediaToken(SITE, "event_covers/ys/albania.jpg")}/original"`);
    const bali = cardOf(html, "Bali");
    expect(bali).toContain(">Ended<");
    expect(bali).not.toContain("From $");
    expect(bali).not.toContain(">Book<");
    expect(bali).toContain('href="https://host.usemingla.com/t/youngandstamped/bali"');
    expect(bali).not.toContain("<img");
    // Cancelled leaves lists.
    expect(html).not.toContain("<h3>Peru</h3>");
    expect(cardOf(html, "Japan")).toContain("Join the waitlist");
    expect(cardOf(html, "Morocco")).toContain("Price on request");
    // No site-hosted detail page, no site booking route, no checkout params.
    expect(html).not.toMatch(/href="\/(trips|book)\//);
    expect(html).not.toMatch(/[?&](site|rt)=/);
  });

  it("a picked cancelled trip says Cancelled", async () => {
    const html = await render({ mode: "all", offering_ids: [{ id: cancelled.id }] }, await live(all));
    expect(cardOf(html, "Peru")).toContain(">Cancelled<");
    expect(cardOf(html, "Peru")).not.toContain(">Book<");
  });

  it("past trips: ended only, newest first", async () => {
    const html = await render({ kind: "trip", mode: "past" }, await live(all));
    expect(html).toContain("<h3>Bali</h3>");
    expect(html).not.toContain("<h3>Albania</h3>");
  });

  it("renders the snapshot the same way when Core is down", async () => {
    const html = await render({ kind: "trip", mode: "upcoming" }, await live([upcoming], "snapshot"));
    expect(html).toContain('data-offering-source="snapshot"');
    expect(cardOf(html, "Albania")).toContain(">Book<");
  });

  it("server-side filters: inverted range and no match each offer Clear search", async () => {
    const block = { kind: "trip", mode: "upcoming", show_filters: true };
    const inverted = await render(block, await live(all, "live", { from: "2026-08-01", to: "2026-07-01" }));
    expect(inverted).toContain("Check your dates");
    expect(inverted).toContain('href="/trips">Clear search');
    const none = await render(block, await live(all, "live", { where: "Antarctica" }));
    expect(none).toContain("No trips match those dates");
    expect(none).toMatch(/<form class="offering-filters"[^>]*method="get"/);
  });

  it("an empty grid is honest, never padded", async () => {
    expect(await render({ kind: "trip", mode: "upcoming", empty_text: "New dates soon." }, await live([]))).toContain("New dates soon.");
    expect(await render({ kind: "event", mode: "upcoming" }, undefined)).toContain("No events to show right now.");
  });

  it("an original v1 grid still renders its fixed list unchanged under atelier", () => {
    const v2 = upgradeV1ToV2(gogiV1Fixture());
    const page = sitePages(v2).find((entry) => entry.blocks.some((block) => block.type === "offering_grid"))!;
    const html = renderToStaticMarkup(<AtelierPage artifact={v2} page={page} />);
    expect(html).toContain("Tasting night");
    expect(html).toContain("View on Mingla");
    expect(html).not.toContain("offering-grid");
  });
});
