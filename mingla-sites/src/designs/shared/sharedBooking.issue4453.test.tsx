/*
 * #4453 M8 x milestone 5 — booking blocks in a private share link. They may
 * render (live Mingla data), but the hand-off still goes to Mingla in a new tab
 * (a share view is a preview: `ctx.preview` is only the Draft-hints flag, false
 * for a client), and the strip stays above every fixed layer the booking chrome
 * and the designs use, with the fixed header starting below it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ preview: null as boolean | null }));
vi.mock("../shared/chrome/Handoff", async (original) => ({
  ...(await original<typeof import("../shared/chrome/Handoff")>()),
  MinglaHandoff: (props: { preview?: boolean }) => { seen.preview = props.preview ?? false; return null; },
}));

import { PageBookingChrome } from "./blocks/Booking";
import type { SharedContext } from "./parts";
import { sharedViewPublicationId } from "../../lib/previewPublication";
import { SHARED_BANNER_STYLE, SHARED_STRIP_CSS } from "../../lib/sharedBanner";

const TEAM_ID = `preview-${"c".repeat(32)}`;
const LIVE_ID = "11111111-1111-4111-8111-111111111111";
const chrome = (publicationId: string, preview: boolean) => {
  seen.preview = null;
  const ctx = {
    artifact: { navigation: { sticky_booking: true, header_cta: { label: "Book a table", href: "https://host.usemingla.com/e/x/y" } } },
    page: { blocks: [] },
    analytics: { siteId: "s", brandId: "b", publicationId },
    preview,
  } as unknown as SharedContext;
  return renderToStaticMarkup(<PageBookingChrome ctx={ctx} />);
};

describe("#4453 M8 booking blocks in a share view", () => {
  it("the hand-off is a preview hand-off (opens Mingla in a new tab) for the team and for a shared link, live only on a published site", () => {
    chrome(TEAM_ID, true);
    expect(seen.preview).toBe(true);
    const html = chrome(sharedViewPublicationId(TEAM_ID), false);
    expect(seen.preview).toBe(true);
    expect(html).toContain("mg-sticky");
    expect(html).toContain("https://host.usemingla.com/e/x/y");
    chrome(LIVE_ID, false);
    expect(seen.preview).toBe(false);
  });

  it("the strip is above the header (60), consent and sticky bar (80), menu and hand-off sheet (90); the fixed header starts below it", () => {
    expect(Number(SHARED_BANNER_STYLE.zIndex)).toBeGreaterThan(90);
    expect(SHARED_BANNER_STYLE.height).toBe(32);
    expect(SHARED_STRIP_CSS).toContain("top:32px");
    expect(SHARED_STRIP_CSS).toContain(".mg-hd");
  });
});
