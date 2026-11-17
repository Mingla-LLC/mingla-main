// @vitest-environment jsdom
/*
 * #4453 milestone 5 — the live booking layouts, the hand-off sheet and the
 * sticky phone bar, rendered (SC-B1, SC-B2, SC-B3, SC-B4, SC-B5).
 *
 * MINGLA-INVARIANT: I-SITES-HANDOFF-IS-A-DIALOG | issue #4453 | every Mingla booking action is a real link to host.usemingla.com; with JavaScript the hand-off sheet traps focus, closes on Escape and returns focus; it never asks for payment details or an email.
 */
import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { availabilityKey, type AvailabilityFeed } from "../../contracts/generated/availability.ts";
import { parseMinglaRating } from "../../contracts/generated/ratings.ts";
import type { BookingView } from "../../lib/bookingFeed";
import { bookingViewFrom } from "../../lib/bookingFeed";
import { AvailabilityStrip, HeroRating, PageBookingChrome, TicketTiersSplit, stickyAction } from "./blocks/Booking";
import { HandoffLink, MinglaHandoff, StickyBookingBar } from "./chrome/Handoff";
import type { SharedContext } from "./parts";

vi.mock("../../lib/clientAnalytics", () => ({
  analyticsAllowed: () => false,
  isPreviewPublication: (id: string) => id === "preview-x",
  sendSiteEvent: async () => undefined,
  siteHandoffHref: (href: string) => href,
}));

const VENUE = "aaaaaaaa-bbbb-4ccc-8ddd-000000000002";
const EVENT = "aaaaaaaa-bbbb-4ccc-8ddd-000000000003";
const TIER = "aaaaaaaa-bbbb-4ccc-8ddd-000000000004";
const OPEN = "https://host.usemingla.com/b/alpha/v/kitchen?tab=book&date=2026-11-20&time=18:00&party=2";
const ask = { source: "venue_slots" as const, target_id: VENUE, party_size: 2, days: 7 };
const slotsFeed: AvailabilityFeed = {
  generated_at: "2026-11-16T12:00:00.000Z", timezone: "Africa/Lagos", source: "venue_slots", title: "Alpha Kitchen",
  days: [
    { local_date: "2026-11-20", slots: [
      { label: "18:00", start_local: "2026-11-20T18:00", state: "open", left: 6, price_minor: null, currency: null, href: OPEN },
      { label: "18:30", start_local: "2026-11-20T18:30", state: "few", left: 2, price_minor: null, currency: null, href: OPEN.replace("18:00", "18:30") },
      { label: "19:00", start_local: "2026-11-20T19:00", state: "full", left: 0, price_minor: null, currency: null, href: null },
    ] },
    { local_date: "2026-11-21", slots: [] },
  ],
};

function ctxWith(booking: BookingView | undefined, over: Partial<SharedContext> = {}): SharedContext {
  return {
    artifact: { language: "en-GB", media: [], navigation: { items: [], sticky_booking: true }, site_id: "s", brand_id: "b", publication_id: "p" } as never,
    page: { blocks: [{ type: "hero", booking_bar: "venue_table", booking_target_id: VENUE }] } as never,
    live: booking ? ({ booking, now: new Date("2026-11-16T12:00:00Z") } as never) : undefined,
    analytics: { siteId: "s", brandId: "b", publicationId: "p" },
    ...over,
  };
}

const view = (over: Partial<BookingView> = {}): BookingView => ({
  availability: new Map([[availabilityKey(ask), slotsFeed]]),
  ticketTiers: new Map(),
  targets: new Map([[`venue_table:${VENUE}`, { kind: "venue_table", id: VENUE, title: "Alpha Kitchen", base_url: "https://host.usemingla.com/b/alpha/v/kitchen", timezone: "Africa/Lagos", min_price_minor: null, currency: null }]]),
  rating: null,
  ...over,
});
const block = { type: "availability", variant: "strip", source: "venue_slots", offering_id: VENUE, party_size: 2, days: 7, heading: "Book a table" };

describe("#4453 M5 availability strip (SC-B1)", () => {
  it("draws only Core's slots; a full slot is text; open slots are Mingla links; an empty day is left out", () => {
    const html = renderToStaticMarkup(<AvailabilityStrip block={block} index={1} ctx={ctxWith(view())} />);
    expect(html).toContain(`href="${OPEN.replaceAll("&", "&amp;")}"`);
    expect(html).toContain("2 left");
    expect(html).toMatch(/<span class="mg-slot mg-slot--full"[^>]*>.*19:00/);
    expect(html).not.toMatch(/<a[^>]*>(?:(?!<\/a>).)*19:00/);
    expect(html).toContain("Times in Africa/Lagos");
    expect(html).not.toContain("Sat");
  });
  it("renders NOTHING with no live data (Core down, another brand's id, no slots)", () => {
    expect(renderToStaticMarkup(<AvailabilityStrip block={block} index={1} ctx={ctxWith(undefined)} />)).toBe("");
    expect(renderToStaticMarkup(<AvailabilityStrip block={{ ...block, offering_id: EVENT }} index={1} ctx={ctxWith(view())} />)).toBe("");
    const empty = { ...slotsFeed, days: [{ local_date: "2026-11-20", slots: [] }] };
    expect(renderToStaticMarkup(<AvailabilityStrip block={block} index={1} ctx={ctxWith(view({ availability: new Map([[availabilityKey(ask), empty]]) }))} />)).toBe("");
  });
  it("adversarial: a cross-brand or full-with-link answer from Core never reaches the page", () => {
    const bad = { ...slotsFeed, days: [{ local_date: "2026-11-20", slots: [{ ...slotsFeed.days[0]!.slots[0]!, href: OPEN.replace("/alpha/", "/beta/") }] }] };
    const parsed = bookingViewFrom({ availability: { [availabilityKey(ask)]: bad } }, { availability: [ask], ticket_tiers: [], targets: [], rating: false }, "alpha");
    expect(parsed.availability.size).toBe(0);
  });
});

describe("#4453 M5 ticket tiers (SC-B2)", () => {
  const feed = (status: string, end: string) => ({ generated_at: "2026-11-16T12:00:00.000Z",
    event: { id: EVENT, title: "Night", start_at: "2026-12-01T19:00:00Z", end_at: end, timezone: "Africa/Lagos", status, public_url: "https://host.usemingla.com/e/alpha/night" },
    tiers: [{ id: TIER, name: "General", price_minor: 500000, currency: "NGN", is_free: false, state: "on_sale", sale_starts_at: null, href: `https://host.usemingla.com/checkout/${EVENT}?seed=${TIER}:1` }] });
  const draw = (status: string, end: string) => renderToStaticMarkup(<TicketTiersSplit block={{ type: "ticket_tiers", offering_id: EVENT }} index={2}
    ctx={ctxWith(bookingViewFrom({ ticket_tiers: { [EVENT]: feed(status, end) } }, { availability: [], ticket_tiers: [EVENT], targets: [], rating: false }, "alpha"))} />);
  it("an on-sale tier buys through this event's checkout", () => {
    const html = draw("scheduled", "2026-12-01T23:00:00Z");
    expect(html).toContain(`href="https://host.usemingla.com/checkout/${EVENT}?seed=${TIER}:1"`);
    expect(html).toContain("General");
  });
  it("renders nothing once the event has ended", () => {
    expect(draw("scheduled", "2026-11-01T23:00:00Z")).toBe("");
    expect(draw("ended", "2026-12-01T23:00:00Z")).toBe("");
  });
});

describe("#4453 M5 rating badge (SC-B3)", () => {
  it("20 approved Mingla reviews show the badge; 19 show nothing; show_rating off shows nothing", () => {
    const at = (count: number) => view({ rating: parseMinglaRating({ source: "mingla_place_reviews", score: 4.62, count }) });
    expect(renderToStaticMarkup(<HeroRating block={{ type: "hero", show_rating: true }} ctx={ctxWith(at(20))} />)).toContain("4.6 · 20 reviews on Mingla");
    expect(renderToStaticMarkup(<HeroRating block={{ type: "hero", show_rating: true }} ctx={ctxWith(at(19))} />)).toBe("");
    expect(renderToStaticMarkup(<HeroRating block={{ type: "hero", show_rating: false }} ctx={ctxWith(at(20))} />)).toBe("");
  });
});

async function mount(node: React.ReactNode): Promise<{ root: HTMLDivElement; unmount: () => void }> {
  const root = document.createElement("div");
  document.body.appendChild(root);
  const r = createRoot(root);
  await act(async () => { r.render(node); });
  return { root, unmount: () => { act(() => r.unmount()); root.remove(); } };
}

describe("#4453 M5 hand-off sheet (SC-B5)", () => {
  it("is a real link without JavaScript (server markup), straight to Mingla", () => {
    const html = renderToStaticMarkup(<HandoffLink detail={{ href: OPEN, item: "Alpha Kitchen", ctaKind: "reservation" }}>Book</HandoffLink>);
    expect(html).toBe(`<a href="${OPEN.replaceAll("&", "&amp;")}" data-mg-handoff="" data-mingla-tracked="1">Book</a>`);
  });
  it("traps focus, closes on Escape and returns focus to the link; never asks for payment or an email", async () => {
    const { root, unmount } = await mount(<>
      <HandoffLink detail={{ href: OPEN, item: "Alpha Kitchen", when: "Fri 20 Nov · 18:00", ctaKind: "reservation" }}>Book 18:00</HandoffLink>
      <MinglaHandoff context={{ siteId: "s", brandId: "b", publicationId: "p" }} />
    </>);
    const link = root.querySelector<HTMLAnchorElement>("a[data-mg-handoff]")!;
    link.focus();
    await act(async () => { link.click(); });
    const dialog = root.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Booked through Mingla");
    expect(dialog.textContent).toContain("Fri 20 Nov · 18:00");
    expect(dialog.querySelectorAll("input, textarea, select")).toHaveLength(0);
    const go = dialog.querySelector<HTMLAnchorElement>("[data-mg-handoff-go]")!;
    expect(document.activeElement).toBe(go);
    expect(go.getAttribute("href")).toBe(OPEN);
    expect(go.getAttribute("target")).toBeNull();
    const close = [...dialog.querySelectorAll("button")].pop()!;
    close.focus();
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); });
    expect(document.activeElement).toBe(go);
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true })); });
    expect(document.activeElement).toBe(close);
    expect(document.documentElement.dataset.mgHandoff).toBe("open");
    await act(async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(root.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(link);
    expect(document.documentElement.dataset.mgHandoff).toBeUndefined();
    unmount();
  });
  it("in the private preview, Continue opens the real Mingla page in a new tab and says so", async () => {
    const { root, unmount } = await mount(<>
      <HandoffLink detail={{ href: OPEN, item: "Alpha Kitchen", ctaKind: "reservation" }}>Book</HandoffLink>
      <MinglaHandoff context={{ siteId: "s", brandId: "b", publicationId: "preview-x" }} />
    </>);
    await act(async () => { root.querySelector<HTMLAnchorElement>("a[data-mg-handoff]")!.click(); });
    expect(root.querySelector("[data-mg-handoff-go]")!.getAttribute("target")).toBe("_blank");
    expect(root.textContent).toContain("This opens the real Mingla page");
    unmount();
  });
});

describe("#4453 M5 sticky phone bar (SC-B4)", () => {
  it("one Mingla action (the hero target), hidden until scripts show it", () => {
    const ctx = ctxWith(view());
    expect(stickyAction(ctx)).toEqual({ href: "https://host.usemingla.com/b/alpha/v/kitchen?tab=book", item: "Alpha Kitchen", from: undefined });
    const html = renderToStaticMarkup(<PageBookingChrome ctx={ctx} />);
    expect(html).toMatch(/<div class="mg-sticky" data-mg-sticky-shown="false" hidden=""/);
    expect(html.match(/href=/g)).toHaveLength(1);
    expect(stickyAction(ctxWith(view(), { artifact: { language: "en-GB", navigation: { items: [] } } as never }))).toBeNull();
  });
  it("hides while a form field has focus or the sheet is open", async () => {
    const observers: Array<(entries: Array<Partial<IntersectionObserverEntry>>) => void> = [];
    vi.stubGlobal("IntersectionObserver", class { constructor(cb: (e: Array<Partial<IntersectionObserverEntry>>) => void) { observers.push(cb); } observe() {} disconnect() {} });
    const main = document.createElement("main");
    main.id = "main";
    main.innerHTML = '<section id="hero">hero</section><input id="field" />';
    document.body.appendChild(main);
    const { root, unmount } = await mount(<StickyBookingBar><a href={OPEN}>Book</a></StickyBookingBar>);
    const bar = root.querySelector<HTMLElement>(".mg-sticky")!;
    expect(bar.hidden).toBe(true);
    await act(async () => { observers[0]!([{ boundingClientRect: { top: -400 } as DOMRect, intersectionRatio: 0.1 }]); });
    expect(bar.hidden).toBe(false);
    await act(async () => { document.getElementById("field")!.focus(); });
    expect(bar.hidden).toBe(true);
    await act(async () => { (document.activeElement as HTMLElement).blur(); await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(bar.hidden).toBe(false);
    await act(async () => { document.documentElement.dataset.mgHandoff = "open"; await new Promise((resolve) => setTimeout(resolve, 5)); });
    expect(bar.hidden).toBe(true);
    delete document.documentElement.dataset.mgHandoff;
    unmount();
    main.remove();
    vi.unstubAllGlobals();
  });
  it("CSS: only below 721 px, 56 px tall, safe-area padding, footer gets matching room; the sheet animates only with motion on", () => {
    const css = fs.readFileSync(path.join(process.cwd(), "public/designs/_shared/blocks-2.css"), "utf8");
    expect(css).toMatch(/\[data-design\] \.mg-sticky \{ display: none; \}/);
    expect(css).toMatch(/@media \(max-width: 720px\) \{\s*\[data-design\] \.mg-sticky:not\(\[hidden\]\) \{[^}]*min-height: 56px;[^}]*env\(safe-area-inset-bottom\)/);
    expect(css).toMatch(/:has\(\.mg-sticky\) footer \{ padding-bottom: calc\(64px \+ env\(safe-area-inset-bottom\)\)/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: no-preference\) \{ \[data-design\] \[data-motion="on"\] \.mg-handoff__sheet \{ animation: mg-sheet-in/);
    expect(css).toMatch(/\.mg-slot \{[^}]*min-height: 44px/);
  });
});
