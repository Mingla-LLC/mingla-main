/**
 * #4111 — implementor happy-path for the signed-out guest's thread page
 * (/m/{token}): every state the page can show, decided by the pure
 * `guestThreadModel`, plus the route's anon contract.
 *
 *   - thread: bubbles (You / "{first} at {Brand}"), "Get replies instantly" app card
 *   - resolved: "{Brand} marked this as resolved. Write again to reopen it."
 *   - expired (410): "Email me a new link" state
 *   - invalid (404) / bad token / network error
 *   - the route is on PUBLIC_BUYER_ROUTE_PREFIXES and never calls useAuth
 *   - the pinned composer adds the #2331 privacy inset on web; the sheet does not
 *
 * FAILS-ON-REVERT: removing the resolved banner, the expired view or the "/m/"
 * prefix fails these assertions.
 */
import { readFileSync } from "fs";
import path from "path";

import { describe, expect, test } from "@jest/globals";

import {
  RESOLVED_BANNER,
  guestThreadModel,
  isGuestThreadToken,
} from "../guestThreadModel";
import { isPublicBuyerRoute } from "../../../utils/coldLoadAuthGates";
import { parseGuestThread } from "../../../services/publicEnquiryService";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const TOKEN = "A".repeat(43);

const raw = (status: string) => ({
  status: "ok",
  brand: { name: "Ctrl", slug: "ctrl", logo_url: null, accent: "#d63d2f" },
  topic_label: "Lost something",
  enquiry_status: status,
  channel_label: "Web",
  messages: [
    { who: "guest", display: "Ada Obi", body: "I left a black denim jacket by the DJ booth.", at: "2026-10-26T09:00:00Z" },
    { who: "brand", display: "Ayo at Ctrl", body: "Security has it.", at: "2026-10-26T10:30:00Z" },
  ],
});

const source = (rel: string): string => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("#4111 /m/{token} page states", () => {
  test("an open thread shows both sides, the app card and no resolved banner", () => {
    const model = guestThreadModel({ kind: "ok", thread: parseGuestThread(raw("replied")) }, NOW);
    expect(model.view).toBe("thread");
    if (model.view !== "thread") return;
    expect(model.brandName).toBe("Ctrl");
    expect(model.subtitle).toBe("Lost something");
    expect(model.bubbles.map((b) => [b.mine, b.meta.split(" · ")[0], b.body])).toEqual([
      [true, "You", "I left a black denim jacket by the DJ booth."],
      [false, "Ayo at Ctrl", "Security has it."],
    ]);
    expect(model.resolvedBanner).toBeNull();
    expect(model.appCard).toEqual({
      title: "Get replies instantly",
      body: "Continue in the Mingla app.",
      cta: "Get the app",
    });
  });

  test("a resolved thread shows the reopen banner", () => {
    const model = guestThreadModel({ kind: "ok", thread: parseGuestThread(raw("resolved")) }, NOW);
    expect(model.view === "thread" && model.resolvedBanner).toBe(
      "Ctrl marked this as resolved. Write again to reopen it.",
    );
    expect(RESOLVED_BANNER("Lantern Room")).toBe("Lantern Room marked this as resolved. Write again to reopen it.");
  });

  test("expired, invalid, error and loading each have their own view", () => {
    expect(guestThreadModel({ kind: "expired" }).view).toBe("expired");
    expect(guestThreadModel({ kind: "invalid" }).view).toBe("invalid");
    expect(guestThreadModel({ kind: "error" }).view).toBe("error");
    expect(guestThreadModel({ kind: "loading" }).view).toBe("loading");
    const screen = source("src/components/brandContact/GuestThreadScreen.tsx");
    expect(screen).toContain('"Email me a new link"');
    expect(screen).toContain("requestNewThreadLink");
  });

  test("tokens are validated before any request", () => {
    expect(isGuestThreadToken(TOKEN)).toBe(true);
    expect(isGuestThreadToken("short")).toBe(false);
    expect(isGuestThreadToken("../../etc/passwd-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")).toBe(false);
    expect(() => parseGuestThread({ status: "nope" })).toThrow("guest_thread_malformed");
  });
});

describe("#4111 /m/{token} route contract", () => {
  test("/m/ is a public buyer route and the route never calls useAuth", () => {
    expect(isPublicBuyerRoute(`/m/${TOKEN}`)).toBe(true);
    const route = source("app/m/[token].tsx");
    const screen = source("src/components/brandContact/GuestThreadScreen.tsx");
    for (const file of [route, screen]) {
      expect(file).not.toMatch(/\buseAuth\s*\(/);
      expect(file).not.toMatch(/AuthContext/);
    }
    // The screen loads lazily from the route.
    expect(route).toContain("React.lazy(");
  });

  test("the pinned composer clears the privacy bar on web; the message sheet stays at bottom 0", () => {
    const pinnedWeb = source("src/components/brandContact/PinnedBottomBar.web.tsx");
    expect(pinnedWeb).toContain('bottom: "var(--mingla-privacy-inset, 0px)"');
    expect(pinnedWeb).toContain('position: "fixed"');
    const sheet = source("../packages/brand-rendering/enquiry/BrandMessageSheet.tsx");
    expect(sheet).not.toContain("--mingla-privacy-inset:");
    expect(sheet).not.toMatch(/var\(--mingla-privacy-inset/);
  });
});
