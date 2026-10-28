/*
 * #2829 W7 — the voyage design, rendered through the real page from a
 * neutral fixture with the travel reference's block composition.
 *
 *  - every (block type, variant) voyage registers is drawn, and nothing else;
 *  - the fixture is a valid v2 artifact on voyage;
 *  - chrome: head script (nonce'd), skip link, header with the disclosure,
 *    footer with the tagline, columns, socials, copyright and "Powered by
 *    Mingla" (never a builder's credit);
 *  - blocks keep the reference class names (cover, band, quote-wall,
 *    grid-cards, faq-columns, history, cta-panel, brandfilm, form-panel…);
 *  - count-aware grids: ten questions split 5 / 5, two stay in one column;
 *    tiles carry their count; a lone card or tile fills the row;
 *  - templates: destination, root-level story and the 404.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64"), videoCdnHosts: [] }) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { VoyagePage } from "./VoyagePage";
import { VOYAGE_BLOCK_VARIANTS } from "./voyageBlocks";
import { faqColumns } from "./blocks/FaqAccordionColumns";
import { tripLength } from "./blocks/OfferingGridPhotoCard";
import { copyrightLine } from "./VoyageFooter";
import { formatDayRange } from "./parts";
import { VOYAGE_HEAD_SCRIPT } from "./headScript";
import { voyageSyntheticArtifact } from "../../contracts/voyageSynthetic.fixture";
import { w5EndedTrips } from "../../contracts/w5Content.fixture";
import { assertArtifactV2 } from "../../contracts/generated/artifactV2.ts";
import { VOYAGE } from "../../contracts/generated/designs.ts";
import { offeringCard, offeringFilters, type LiveOfferings } from "../../lib/offeringCards";
import { resolveSitePath, type ArtifactPage } from "../../lib/pageRouting";
import type { FormsContext } from "../../lib/siteForms";
import type { ArtifactV2 } from "../../contracts/generated/artifactV2.ts";

const NOW = new Date("2026-10-26T12:00:00Z");
const forms: FormsContext = { renderedAt: 1_760_000_000_000, signature: "stamp", enquiries: "available", preview: false, notice: null } as unknown as FormsContext;

async function live(artifact: ArtifactV2, search?: Record<string, string>): Promise<LiveOfferings> {
  const offerings = w5EndedTrips();
  const cards = new Map();
  for (const offering of offerings) cards.set(offering.id, await offeringCard(artifact.site_id, offering, NOW, "en"));
  return { source: "live", offerings, cards, now: NOW, filters: offeringFilters(search) };
}

async function render(path: string, search?: Record<string, string>) {
  const artifact = voyageSyntheticArtifact();
  const resolved = resolveSitePath(artifact, path);
  const page = resolved.kind === "page" || resolved.kind === "entry" ? (resolved.page as ArtifactPage) : undefined;
  const entry = resolved.kind === "entry" ? resolved.entry : undefined;
  return renderToStaticMarkup(
    <VoyagePage artifact={artifact} page={page} entry={entry} live={await live(artifact, search)} forms={forms} nonce="n0nce" notFound={resolved.kind === "not_found"} />,
  );
}

describe("#2829 W7 voyage design", () => {
  it("draws exactly the variants the registry lists for every block type", () => {
    for (const [type, variants] of Object.entries(VOYAGE.variants)) {
      expect(Object.keys(VOYAGE_BLOCK_VARIANTS[type as keyof typeof VOYAGE_BLOCK_VARIANTS]).sort(), type).toEqual([...variants].sort());
    }
  });

  it("the neutral fixture is a valid voyage artifact", () => {
    expect(() => assertArtifactV2(voyageSyntheticArtifact())).not.toThrow();
  });

  it("chrome: nonce'd head script, skip link, header, footer with Mingla's credit only", async () => {
    const html = await render("");
    expect(html).toContain(`<script nonce="n0nce">${VOYAGE_HEAD_SCRIPT}</script>`);
    expect(html).toContain('<a href="#main" class="skip-link">Skip to content</a>');
    expect(html).toMatch(/<header class="site-header" data-stuck="false">/);
    expect(html).toContain('Fixture <span class="amp">&amp;</span> Friends');
    expect(html).toContain('aria-haspopup="true"');
    expect(html).toContain("v-header-cta");
    expect(html).toContain('<span class="footer-script">Go somewhere.</span>');
    expect(html).toContain(`Copyright © ${NOW.getUTCFullYear()} Fixture &amp; Friends. All rights reserved.`.replace(String(NOW.getUTCFullYear()), String(new Date().getUTCFullYear())));
    expect(html).toContain('aria-label="Instagram" class="footer-social"');
    expect(html).toContain("Powered by Mingla");
    expect(html).not.toMatch(/Built by/i);
  });

  it("home: cover hero with lines and search, tiles with icons, empty upcoming card, quote wall, lone destination, stories, newsletter", async () => {
    const html = await render("");
    expect(html).toContain('class="cover cover--bottom on-photo v-cover"');
    expect(html).toMatch(/<h1 class="v-hero__title"><span class="line-mask"><span class="v-block"[^>]*>Go somewhere\.<\/span><\/span><span class="line-mask">/);
    expect(html).toMatch(/<form role="search"[^>]*v-search--hero[^>]*action="\/trips" method="get">/);
    expect(html).toContain('class="v-tiles" data-count="4"');
    expect((html.match(/class="tile-icon"><svg/g) ?? []).length).toBe(4);
    expect(html).toContain("No upcoming trips right now");
    expect(html).toContain('href="/contact-us">Get in touch');
    expect(html).toContain('class="quote-wall"');
    expect(html).toContain('class="dest-tile__name">Harbour Coast</span>');
    expect(html).toContain('class="chip-category">Notes</span>');
    expect(html).toContain('href="/first-light"');
    expect(html).toContain('class="v-newsletter__form"');
  });

  it("about: page header, brand film, statements, split, ledger counted from rows with chosen links, contact tiles", async () => {
    const html = await render("about-us");
    expect(html).toContain('class="cover cover--center v-cover v-cover--header on-photo"');
    expect(html).toContain('<li><a class="v-crumb-link" href="/">Home</a></li>');
    expect(html).toContain('class="brandfilm on-dark" data-playing="false"');
    expect(html).toContain('class="v-statements"');
    expect(html).toContain('class="history on-light"');
    expect(html).toContain('<span class="history__count tnum">3</span> <span class="history__unit">trips run</span>');
    expect(html).toContain("January 14 – June 20, 2025");
    expect((html.match(/See the trip/g) ?? []).length).toBe(1);
    expect(html).toContain("Email: <a href=\"mailto:hello@fixture.invalid\" class=\"link\">");
  });

  it("questions: ten split five and five into two accordions; trips: two stay in one column", async () => {
    const faqs = await render("faqs");
    expect(faqs).toContain('class="faq-columns"');
    expect((faqs.match(/<details>/g) ?? []).length).toBe(10);
    expect(faqColumns([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).map((column) => column.length)).toEqual([5, 5]);
    expect(faqColumns([1, 2, 3, 4, 5]).map((column) => column.length)).toEqual([3, 2]);
    expect(faqColumns([1, 2, 3])).toHaveLength(1);
    expect(faqs).toContain('class="cta-panel on-dark"');
    const trips = await render("trips");
    expect(trips).toContain('class="v-faq-single"');
    expect(trips).toContain("Upcoming trips");
    expect(trips).toContain("Past trips");
    expect(trips).toContain('class="chip-status chip-status--state">Ended</span>');
  });

  it("trips filters: ?where narrows the past trips; an inverted range says so", async () => {
    const narrowed = await render("trips", { where: "coast" });
    expect(narrowed).toContain("Coast Week");
    expect(narrowed).not.toContain("Mountain Ski Weekend (Lakeside)");
    expect(narrowed).toContain("Clear search");
    const inverted = await render("trips", { from: "2026-02-01", to: "2026-01-01" });
    expect(inverted).toContain("Check your dates");
  });

  it("contact: the form panel posts to the site's own route with Name required (#4111)", async () => {
    const html = await render("contact-us");
    expect(html).toContain('class="form-panel card card--raised"');
    expect(html).toContain('action="/api/forms/contact"');
    expect(html).toMatch(/class="form-label">Name<\/label><input[^>]*required=""/);
    expect(html).toContain("First fixture line.\nSecond fixture line.");
  });

  it("a page header with no picture sits on the lit dark panel; prose keeps its structure", async () => {
    const html = await render("privacy");
    expect(html).toContain("on-dark header-gradient");
    expect(html).toContain('<div class="prose"><h2>Fixture section</h2>');
    expect(html).toContain("<ul><li>One</li>");
  });

  it("templates: destination (facts strip, seasons, did you know, related trip card), root story, 404", async () => {
    const destination = await render("places/harbour-coast");
    expect(destination).toContain('<li><a class="v-crumb-link" href="/places">Places</a></li>');
    expect(destination).toContain('class="dest-facts on-dark"');
    expect(destination).toContain('class="chip-activity">Swimming</li>');
    expect(destination).toContain("Harbour Coast – must know &amp; facts");
    expect(destination).toContain("Related trips");
    const story = await render("first-light");
    expect(story).toContain('class="eyebrow v-story-eyebrow">Notes');
    expect(story).toContain("March 2, 2026");
    const missing = await render("no-such-page");
    expect(missing).toContain('class="notfound band"');
    expect(missing).toContain("This page has moved on");
    expect(missing).toContain('href="/trips">Browse trips');
    expect(missing).not.toContain("cover--");
  });

  it("words: trip length, day ranges, copyright", () => {
    expect(tripLength({ kind: "trip", start_at: "2026-08-14T16:00:00Z", end_at: "2026-08-21T16:00:00Z", timezone: "America/New_York" })).toBe("7 days");
    expect(tripLength({ kind: "event", start_at: "2026-08-14T16:00:00Z", end_at: "2026-08-21T16:00:00Z", timezone: null })).toBeNull();
    expect(formatDayRange("2025-01-24", "2026-06-20")).toBe("January 24, 2025 – June 20, 2026");
    expect(formatDayRange("2026-06-20", "2026-06-27")).toBe("June 20–27, 2026");
    expect(copyrightLine("© {year} {site_name}", { timezone: "UTC", brand: { display_name: "X" } }, new Date("2030-01-01T00:00:00Z"))).toBe("© 2030 X");
  });

  it("very long names and taglines wrap at headline sizes and never push the header past the viewport", () => {
    const css = readFileSync(resolve(process.cwd(), "public/designs/voyage/1.css"), "utf8");
    expect(css).toMatch(/h1,[\s\S]*?h4 \{[\s\S]*?text-wrap: balance;[\s\S]*?overflow-wrap: anywhere;/);
    expect(css).toMatch(/\.logo-lockup \{[\s\S]*?min-width: 0;[\s\S]*?max-width: min\(42vw, 24rem\);/);
    expect(css).toMatch(/\.logo-lockup > span \{[\s\S]*?overflow: hidden;[\s\S]*?text-overflow: ellipsis;/);
  });
});
