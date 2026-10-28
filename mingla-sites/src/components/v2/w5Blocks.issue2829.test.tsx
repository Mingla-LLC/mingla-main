/*
 * #2829 W5 (SC-21, SC-23, A1.3, A4) — destinations, stories, reviews, the
 * trips-we've-run ledger, destination and story pages, the contact form and
 * the newsletter box, rendered through the real atelier page.
 *
 *  - grids list the publication's own entries and link to their pages
 *    (stories at the site root when routes.stories is "");
 *  - reviews are drawn verbatim (typos kept) with the linked Mingla trip;
 *  - the ledger lists ended Mingla trips, grouping a run under its name;
 *  - destination and story pages resolve at their addresses (a page always
 *    wins) and show only what the owner wrote; related trips come from the
 *    feed and link to the existing Mingla page;
 *  - forms post to the site's own routes with the stamp and honeypot; the
 *    contact form disappears when the brand takes no messages; a preview's
 *    forms are switched off; a no-JS outcome is shown on the right form.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/config", () => ({ runtimeConfig: () => ({ runtimeHmac: Buffer.alloc(32, 9).toString("base64") }) }));

import { AtelierPage } from "../../designs/atelier/AtelierPage";
import { W5, w5Artifact, w5EndedTrips } from "../../contracts/w5Content.fixture";
import { offeringCard, offeringFilters, type LiveOfferings } from "../../lib/offeringCards";
import { resolveSitePath, type ArtifactPage } from "../../lib/pageRouting";
import { formNoticeFrom, type FormsContext } from "../../lib/siteForms";
import type { ArtifactV2 } from "../../contracts/generated/artifactV2.ts";

const NOW = new Date("2026-10-26T12:00:00Z");

async function liveFeed(artifact: ArtifactV2): Promise<LiveOfferings> {
  const offerings = w5EndedTrips();
  const cards = new Map();
  for (const offering of offerings) cards.set(offering.id, await offeringCard(artifact.site_id, offering, NOW, "en"));
  return { source: "live", offerings, cards, now: NOW, filters: offeringFilters(undefined) };
}

const forms = (patch: Partial<FormsContext> = {}): FormsContext => ({
  renderedAt: 1_760_000_000_000,
  signature: "stamp-signature",
  enquiries: "unknown",
  notice: null,
  ...patch,
});

function pageAt(artifact: ArtifactV2, path: string): { page: ArtifactPage; html: (extra?: Record<string, unknown>) => string } {
  const resolved = resolveSitePath(artifact, path);
  if (resolved.kind !== "page" && resolved.kind !== "entry") throw new Error(`no page at ${path}: ${resolved.kind}`);
  const entry = resolved.kind === "entry" ? resolved.entry : undefined;
  return {
    page: resolved.page,
    html: (extra = {}) =>
      renderToStaticMarkup(
        <AtelierPage artifact={artifact as never} page={resolved.page} entry={entry} {...extra} />,
      ),
  };
}

describe("#2829 W5 collection blocks", () => {
  it("lists destinations and links each to its page under the destinations address", () => {
    const html = pageAt(w5Artifact(), "places").html();
    expect(html).toContain('href="/places/harbour-coast"');
    expect(html).toContain('href="/places/pine-valley"');
    expect(html).toContain("Salt air and slow mornings.");
  });

  it("lists stories newest first, capped, with dates and categories; at the site root when asked", () => {
    const html = pageAt(w5Artifact(), "journal").html();
    expect(html.indexOf("Packing list")).toBeLessThan(html.indexOf("First light"));
    expect(html).not.toContain("Old friends"); // limit 2
    expect(html).toContain('href="/stories/packing-list"');
    expect(html).toContain("May 10, 2026");
    expect(html).toContain("Guides");
    const root = pageAt(w5Artifact({ storiesAtRoot: true }), "journal").html();
    expect(root).toContain('href="/packing-list"');
  });

  it("draws confirmed reviews verbatim with the linked Mingla trip", async () => {
    const artifact = w5Artifact();
    const html = pageAt(artifact, "reviews").html({ live: await liveFeed(artifact) });
    expect(html).toContain("“Best expierence, would go agian.”");
    expect(html).toContain("Fixture R");
    expect(html).toContain('<a href="https://host.usemingla.com/t/fixture-brand/coast-week-2025">Coast Week</a>');
    expect(html).not.toMatch(/★|stars?|rating/i);
  });

  it("lists the trips we've run from Mingla, a run grouped under its name, no price or booking", async () => {
    const artifact = w5Artifact();
    const html = pageAt(artifact, "reviews").html({ live: await liveFeed(artifact) });
    const start = html.indexOf("site-ledger");
    const ledger = html.slice(start, html.indexOf("</section>", start));
    expect(ledger).toContain("Mountain ski series");
    expect(ledger).toContain("2 departures");
    expect(ledger).toContain("Mountain Town, NC");
    expect(ledger).toContain("January 14, 2025");
    expect(ledger).toContain("January 21, 2025");
    expect(ledger).toContain("Coast Week");
    expect(ledger.indexOf("Coast Week")).toBeLessThan(ledger.indexOf("Mountain ski series"));
    expect(ledger).not.toMatch(/Book|Price on request|\$/);
    // With no feed at all the ledger says so, never an invented list.
    expect(pageAt(artifact, "reviews").html()).toContain("This list is unavailable right now.");
  });
});

describe("#2829 W5 destination and story pages", () => {
  it("resolves destinations and stories at their addresses; a page always wins", () => {
    const artifact = w5Artifact();
    expect(resolveSitePath(artifact, "places/harbour-coast").kind).toBe("entry");
    expect(resolveSitePath(artifact, "stories/first-light").kind).toBe("entry");
    expect(resolveSitePath(artifact, "first-light").kind).toBe("not_found");
    expect(resolveSitePath(artifact, "places/atlantis").kind).toBe("not_found");
    const root = w5Artifact({ storiesAtRoot: true });
    expect(resolveSitePath(root, "first-light").kind).toBe("entry");
    expect(resolveSitePath(root, "stories/first-light").kind).toBe("not_found");
    expect(resolveSitePath(root, "journal").kind).toBe("page");
  });

  it("shows the owner's destination, its facts as typed, and related trips from the feed", async () => {
    const artifact = w5Artifact();
    const html = pageAt(artifact, "places/harbour-coast").html({ live: await liveFeed(artifact) });
    expect(html).toContain("<h1>Harbour Coast</h1>");
    expect(html).toContain("<dt>Language</dt><dd>Fixture tongue</dd>");
    expect(html).not.toContain("<dt>Religion</dt>"); // not written → not drawn
    expect(html).toContain("We keep going back to the coast.");
    expect(html).toContain("Swimming");
    expect(html).toContain("The harbour is older than the town.");
    expect(html).toContain('href="https://host.usemingla.com/t/fixture-brand/coast-week-2025"');
    // A related trip that no longer resolves simply disappears.
    const gone = structuredClone(artifact);
    gone.collections.destinations[0]!.related_offering_ids = ["aaaaaaaa-bbbb-4ccc-8ddd-000000000999"];
    const goneHtml = pageAt(gone, "places/harbour-coast").html({ live: await liveFeed(gone) });
    expect(goneHtml).not.toContain("Trips here");
  });

  it("shows a story with its date and category", () => {
    const html = pageAt(w5Artifact({ storiesAtRoot: true }), "first-light").html();
    expect(html).toContain("<h1>First light</h1>");
    expect(html).toContain("March 2, 2026");
    expect(html).toContain("Notes");
    expect(html).toContain("We left before dawn.");
  });
});

describe("#2829 W5 contact form and newsletter", () => {
  it("posts to the site's own routes with the stamp, the position and a hidden honeypot", () => {
    const html = pageAt(w5Artifact(), "contact-us").html({ forms: forms() });
    expect(html).toContain('action="/api/forms/contact"');
    expect(html).toContain('action="/api/forms/newsletter"');
    expect(html).toContain('id="form-0"');
    expect(html).toContain('id="form-1"');
    expect(html).toContain('name="page" value="contact-us"');
    expect(html).toContain('name="block" value="0"');
    expect(html).toContain('name="t0" value="1760000000000"');
    expect(html).toContain('name="ts" value="stamp-signature"');
    expect(html).toMatch(/class="site-form-trap" aria-hidden="true"><label>Leave this empty<input type="text" tabindex="-1" autoComplete="off" name="website" value=""\/>/);
    expect(html).toContain('name="phone"');
    expect(html).toMatch(/name="message" required=""/);
    expect(html).toContain("Unsubscribe any time.");
  });

  it("hides the contact form when the brand takes no messages, keeping the owner's email", () => {
    const html = pageAt(w5Artifact(), "contact-us").html({ forms: forms({ enquiries: "unavailable" }) });
    expect(html).not.toContain('action="/api/forms/contact"');
    expect(html).toContain('data-enquiries="unavailable"');
    expect(html).toContain("mailto:hello@fixture.invalid");
    expect(html).toContain('action="/api/forms/newsletter"');
  });

  it("switches a preview's forms off", () => {
    const html = pageAt(w5Artifact(), "contact-us").html({ forms: forms({ preview: true }) });
    expect(html).toContain("Forms don&#x27;t send from a preview.");
    expect(html).toMatch(/<button type="submit" class="button accent site-form-submit" disabled="">/);
  });

  it("shows a no-JavaScript outcome on the form it belongs to", () => {
    const sent = pageAt(w5Artifact(), "contact-us").html({ forms: forms({ notice: formNoticeFrom({ sent: "newsletter", form: "1" }) }) });
    expect(sent).toContain("Check your inbox to confirm your subscription.");
    const refused = pageAt(w5Artifact(), "contact-us").html({ forms: forms({ notice: formNoticeFrom({ formError: "email", formKind: "contact", form: "0" }) }) });
    expect(refused).toContain("Please check your email address.");
    expect(refused).toContain('data-form-outcome="error"');
    // Junk in the address is ignored, never shown.
    expect(formNoticeFrom({ formError: "<script>", formKind: "contact", form: "0" })).toBeNull();
    expect(formNoticeFrom({ sent: "contact", form: "99" })).toBeNull();
  });

  it("never renders a form on a page without a stamp", () => {
    const html = pageAt(w5Artifact(), "contact-us").html();
    expect(html).not.toContain("<form");
    expect(W5.storyA).toBeTruthy();
  });
});
