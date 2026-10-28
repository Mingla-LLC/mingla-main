/*
 * #2829 W10 — the site's visitor events: the five new ones (book_click,
 * form_submit_contact, form_submit_newsletter, outbound_click; offering_view
 * already existed) are recorded ONLY with the visitor's analytics consent,
 * for the site Core resolved for this host, and a page address travels only
 * as a bare path (no query, fragment or anything else).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const recorded = vi.hoisted(() => ({ events: [] as Array<{ site: unknown; event: Record<string, unknown> }> }));
const SITE = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const PUB = "33333333-3333-4333-8333-333333333333";
vi.mock("../../../lib/publication", () => ({
  requestHost: () => "young.sites.usemingla.com",
  loadPublication: async () => ({
    artifact: { site_id: SITE, brand_id: BRAND, publication_id: PUB },
    resolution: { site_id: SITE },
  }),
}));
vi.mock("../../../lib/siteEvents", async (original) => ({
  ...(await original<typeof import("../../../lib/siteEvents")>()),
  recordSiteEvent: async (site: unknown, event: Record<string, unknown>) => { recorded.events.push({ site, event }); },
}));

import { POST } from "./route";

function post(body: Record<string, unknown>, consent: boolean): Request {
  return new Request("https://young.sites.usemingla.com/api/events", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(consent ? { cookie: "other=1; mingla_site_analytics_consent_v1=granted" } : {}),
    },
    body: JSON.stringify(body),
  });
}
const event = (name: string, extra: Record<string, unknown> = {}) => ({
  event_name: name, site_id: SITE, brand_id: BRAND, publication_id: PUB,
  consent_policy_version: "sites-v1", event_id: crypto.randomUUID(), ...extra,
});

beforeEach(() => { recorded.events = []; });

describe("#2829 W10 visitor events", () => {
  it("records each new event with consent, for the resolved site", async () => {
    for (const name of ["offering_view", "book_click", "form_submit_contact", "form_submit_newsletter", "outbound_click"]) {
      const response = await POST(post(event(name, { page_path: "/trips" }), true));
      expect(response.status, name).toBe(202);
    }
    expect(recorded.events.map((row) => row.event.event_name)).toEqual([
      "offering_view", "book_click", "form_submit_contact", "form_submit_newsletter", "outbound_click",
    ]);
    expect(recorded.events.every((row) => (row.site as { site_id: string }).site_id === SITE && row.event.page_path === "/trips")).toBe(true);
  });

  it("records nothing without consent (or with consent withheld)", async () => {
    for (const name of ["book_click", "outbound_click", "page_view"]) {
      expect((await POST(post(event(name), false))).status).toBe(403);
    }
    const refused = new Request("https://young.sites.usemingla.com/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "mingla_site_analytics_consent_v1=necessary" },
      body: JSON.stringify(event("book_click")),
    });
    expect((await POST(refused)).status).toBe(403);
    expect(recorded.events).toHaveLength(0);
  });

  it("refuses an unknown event, a page address with a query or markup, and another site's ids", async () => {
    expect((await POST(post(event("scroll_depth"), true))).status).toBe(400);
    for (const page_path of ["/trips?email=a@b.c", "/trips#x", "trips", "/<script>", 7]) {
      expect((await POST(post(event("page_view", { page_path }), true))).status, String(page_path)).toBe(400);
    }
    expect((await POST(post(event("page_view", { site_id: BRAND }), true))).status).toBe(403);
    expect(recorded.events).toHaveLength(0);
  });
});
