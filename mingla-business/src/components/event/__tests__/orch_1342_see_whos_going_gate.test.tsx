/**
 * ORCH-1342 [web-see-whos-going-funnel] — SeeWhosGoingGate guard suite
 * (SPEC §7 T-6 + T-A6/T-A7 source halves + the §4.4 wiring map;
 * META-ORCH-1337 Leg 5). SOURCE-STRUCTURAL under the default node/ts-jest
 * config (RTL render harnesses exist only under dedicated per-ORCH configs —
 * see jest.config.cjs; the runtime half is the tester's T-12).
 *
 * Pins (I-PROPOSED-1342-GATE-NEVER-NAMES-NEVER-REDIRECTS +
 * I-PROPOSED-1187-ANALYTICS-WEB-ONLY-VIA-WEB-TS):
 *   1. D1 — the gate consumes ONLY avatarUrl from the sample; no guest
 *      identity token (displayName/username/display_name/profileId) exists in
 *      the gate source; PeerGuestRow never reaches it.
 *   2. Never a redirect — the CTA routes through openExternal (window.open
 *      first, location.assign fallback lives in guestFunnelLink); no
 *      `location.href =` primary anywhere in the gate.
 *   3. ONE builder — the QR value and the CTA both come from
 *      resolveGuestFunnelTarget (no second URL composition in the gate).
 *   4. Platform split — react-qr-code is imported ONLY in GateQr.web.tsx; the
 *      native GateQr.tsx stub renders null; the gate imports "./GateQr".
 *   5. hidden ⇒ null (COMMS-0084 posture) + DESIGN §4 copy byte-exact +
 *      §4.4.3 analytics via captureWeb (postHogService is a web NO-OP stub).
 *   6. §4.4.1 wiring — every web mount passes onSeeWhosGoing ONLY under
 *      Platform.OS === 'web' (business native keeps the inert cluster).
 *
 * FAILS-ON-REVERT: pointing the QR at anything but target.qrUrl, adding an
 * identity prop, swapping openExternal for a redirect, importing react-qr-code
 * into the native stub, or dropping a web-only wiring makes a named test FAIL.
 */

import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "node:fs";
import path from "node:path";

const read = (rel: string): string =>
  readFileSync(path.resolve(__dirname, rel), "utf8");
const strip = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const gate = strip(read("../SeeWhosGoingGate.tsx"));
const gateRaw = read("../SeeWhosGoingGate.tsx");
const qrWeb = strip(read("../GateQr.web.tsx"));
const qrNative = strip(read("../GateQr.tsx"));
const publicEventPage = strip(read("../PublicEventPage.tsx"));
const tripRoute = strip(read("../../../../app/t/[brandSlug]/[tripSlug].tsx"));
const expRoute = strip(
  read("../../../../app/exp/[brandSlug]/[experienceSlug].tsx"),
);

describe("ORCH-1342 T-6 — never names (D1)", () => {
  test("no guest identity token is consumed or rendered by the gate", () => {
    for (const banned of [
      "displayName",
      "display_name",
      "username",
      "profileId",
      "PeerGuestRow",
      "fetchPeerGuestList",
    ]) {
      expect(gate).not.toContain(banned);
    }
  });
  test("only avatarUrl is read off the sample entries", () => {
    expect(gate).toContain("entry.avatarUrl");
    expect(gate).toContain("SocialProofSampleEntry");
  });
  test("the echo row is decorative — hidden from the a11y tree", () => {
    expect(gate).toContain("accessibilityElementsHidden");
    expect(gate).toContain('importantForAccessibility="no-hide-descendants"');
  });
});

describe("ORCH-1342 — never a redirect (ORCH-1328 pattern)", () => {
  test("the CTA opens through openExternal; no location.href primary", () => {
    expect(gate).toContain("openExternal(dest)");
    expect(gate).not.toContain("location.href");
    expect(gate).not.toContain("router.push");
  });
  test("hidden ⇒ renders null (COMMS-0084 — no touch-capturing residue)", () => {
    expect(gate).toContain("if (!visible) return null;");
  });
});

describe("ORCH-1342 T-A7 — ONE builder feeds both the CTA and the QR", () => {
  test("the QR encodes resolveGuestFunnelTarget(...).qrUrl verbatim", () => {
    expect(gate).toContain("resolveGuestFunnelTarget(entity, platform)");
    expect(gate).toContain("<GateQr value={resolved.target.qrUrl} size={180} />");
  });
  test("no second URL grammar: the gate never mints a OneLink itself", () => {
    expect(gate).not.toContain("deep_link_value");
    expect(gate).not.toContain("go.usemingla.com");
  });
  test("badges use the SSOT constants (drift-gated)", () => {
    expect(gate).toContain("APP_STORE_URL");
    expect(gate).toContain("PLAY_STORE_URL");
    expect(gate).toContain('from "../../constants/storeLinks"');
  });
});

describe("ORCH-1342 — GateQr platform split (bundle-budget posture)", () => {
  test("react-qr-code lives ONLY in the .web variant, loaded LAZILY (ORCH-1083 budget)", () => {
    // DYNAMIC import (React.lazy) — a static import re-enters the eager
    // __common chunk and fails the ORCH-1083 budget gate (measured +31KB).
    expect(qrWeb).toContain('React.lazy(() => import("react-qr-code"))');
    expect(qrWeb).not.toContain('from "react-qr-code"');
    expect(qrNative).not.toContain("react-qr-code");
    expect(gate).not.toContain("react-qr-code");
    expect(gate).toContain('from "./GateQr"');
  });
  test("the native stub renders null; the web QR mirrors the /download props", () => {
    expect(qrNative).toContain("=> null;");
    expect(qrWeb).toContain('fgColor="#0E0E10"');
    expect(qrWeb).toContain('bgColor="#FFFFFF"');
    expect(qrWeb).toContain('level="M"');
    expect(qrWeb).toContain('role="img"');
    expect(qrWeb).toContain("QR code — scan to get the Mingla app");
  });
});

describe("ORCH-1342 — DESIGN §4 copy (byte-exact) + variant split", () => {
  test("web copy block", () => {
    expect(gateRaw).toContain("See who's going");
    expect(gateRaw).toContain(
      "Guest faces, names, and the group chat live in the Mingla app.",
    );
    expect(gateRaw).toContain("Get the app");
    expect(gateRaw).toContain("Not now");
    expect(gateRaw).toContain("MINGLA");
    expect(gateRaw).toContain(
      "Scan with your phone — the full guest list lives in the app.",
    );
  });
  test("variant split rides useResponsiveLayout().isDesktop (DESIGN §3.3)", () => {
    expect(gate).toContain("useResponsiveLayout()");
    expect(gate).toContain('"desktop_qr"');
    expect(gate).toContain('"phone_panel"');
  });
  test("the ONE sanctioned non-palette fill is the white QR card", () => {
    expect(gate).toContain('backgroundColor: "#ffffff"');
  });
});

describe("ORCH-1342 §4.4.3 — analytics via the buyer-web facade", () => {
  test("the gate fires (b) and (c) through captureWeb — never postHogService", () => {
    expect(gate).toContain('captureWeb("guest_gate_get_app_clicked"');
    expect(gate).toContain('captureWeb("guest_gate_dismissed"');
    expect(gate).not.toContain("postHogService");
  });
  test("dismiss methods cover not_now / scrim / close / esc", () => {
    for (const m of ['"not_now"', '"scrim"', '"close"']) {
      expect(gate).toContain(`dismiss(${m})`);
    }
    // Esc fires through the stable listener ref (same dismiss, same capture).
    expect(gate).toContain('dismissRef.current("esc")');
  });
});

describe("ORCH-1342 §4.4.1 — web-only wiring on every mount (T-A6 posture)", () => {
  test("PublicEventPage wires the handler web-only + fires (a) + mounts the gate in BOTH branches", () => {
    expect(publicEventPage).toContain(
      'Platform.OS === "web" ? handleSeeWhosGoingWeb : undefined',
    );
    expect(publicEventPage).toContain('captureWeb("see_whos_going_clicked"');
    // ONE gate element per branch return (RSVP + ticketed).
    const mounts = publicEventPage.split("<SeeWhosGoingGate").length - 1;
    expect(mounts).toBe(2);
    // the RSVP config literal carries the prop; the ticketed branch passes it
    // through FoundationEventPreview.
    expect(publicEventPage).toContain("onSeeWhosGoing: onSeeWhosGoingProp");
    expect(publicEventPage).toContain("onSeeWhosGoing={onSeeWhosGoingProp}");
  });
  test("the /t and /exp routes wire the gate the same way", () => {
    for (const src of [tripRoute, expRoute]) {
      expect(src).toContain(
        'Platform.OS === "web" ? handleSeeWhosGoingWeb : undefined',
      );
      expect(src).toContain('captureWeb("see_whos_going_clicked"');
      expect(src).toContain("<SeeWhosGoingGate");
    }
  });
  test("ORCH-1083 budget: every mount lazy-loads the gate + renders it conditionally", () => {
    // A static import of SeeWhosGoingGate re-enters the eager __common chunk
    // and fails the bundle-budget gate (measured). The gate is tap-opened —
    // it must stay a deferred chunk, fetched on first open only.
    expect(publicEventPage).toContain(
      'React.lazy(() => import("./SeeWhosGoingGate"))',
    );
    for (const src of [tripRoute, expRoute]) {
      expect(src).toContain(
        'import("../../../src/components/event/SeeWhosGoingGate")',
      );
      expect(src).toContain("React.lazy(");
    }
    for (const src of [publicEventPage, tripRoute, expRoute]) {
      expect(src).toContain("{gateVisible ? (");
      expect(src).toContain("<React.Suspense fallback={null}>");
      expect(src).not.toMatch(
        /import\s*\{\s*SeeWhosGoingGate\s*\}\s*from/,
      );
    }
  });
  test("buyer-web routes NEVER read ?landing (T-A6 — spoofed params are inert)", () => {
    for (const src of [publicEventPage, tripRoute, expRoute]) {
      expect(src).not.toContain("landing=guest-list");
      expect(src).not.toMatch(/params\.landing/);
    }
  });
});
