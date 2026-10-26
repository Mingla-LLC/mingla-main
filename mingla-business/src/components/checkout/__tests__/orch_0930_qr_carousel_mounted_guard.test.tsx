/**
 * #4063 retires buyer-web QR rendering; this guards the replacement handoff.
 * ORCH-0930 / ORCH-0932 — TicketQrCarousel server-side QR image contract.
 *
 * Bug history:
 *   - ORCH-0930 v1 (component mount-guard inside TicketQrCarousel): FAILED
 *   - ORCH-0930 v2 (parent useEffect+setHydrated gate in confirm.tsx): FAILED
 *   - ORCH-0930 v3 (parent useState initializer with typeof window check): FAILED
 * All three failures shared the same DOM signature: carousel host mounts
 * (visible thin strip), but the `react-native-qrcode-svg` <QRCode> SVG
 * subtree never appears in the DOM. Operator screenshot 2026-05-23 after v3
 * deploy (commit 8f1609e3 READY on Vercel) confirmed the strip pattern was
 * unchanged across all three hydration-gate variants. Proves the bug is in
 * client-side SVG generation on Expo SDK 54 web export, not hydration
 * timing.
 *
 * Fix (ORCH-0932): server-side PNG generation via `_shared/ticketQrImage.ts`
 * (using `https://esm.sh/qrcode@1.5.4?bundle` — same pipeline already used
 * for the printed PDF QR in `_shared/ticketPdf.ts`). Edge fns
 * `ticket-checkout-confirm` + `ticket-checkout-status` now include
 * `qrImageDataUrl` (base64 PNG data URI) on every ticket. TicketQrCarousel
 * renders the URI via RN `<Image source={{ uri }} />` — zero SVG runtime
 * dependency. Parent-level isClient gate in confirm.tsx remains as defense
 * in depth against the original ORCH-0928 sessionStorage recovery race.
 *
 * Pattern: source-string assertion (matches the orch_0911 + orch_0928
 * sibling tests under app/checkout-trip/[tripEventId]/__tests__/).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(join(__dirname, "../TicketQrCarousel.tsx"), "utf8");

function stripComments(value: string): string {
  return value
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "")
    .replace(/[ \t]\/\/[^\n]*$/gm, "");
}

const activeSource = stripComments(source);

describe("ORCH-0932 — TicketQrCarousel server-side QR <Image> contract", () => {
  it("HP-1: imports Image from react-native (renders QR via <Image source={{uri}}>)", () => {
    expect(activeSource).toMatch(
      /import\s*\{[^}]*\bImage\b[^}]*\}\s+from\s+["']react-native["']/,
    );
  });

  it("HP-2: does NOT import from react-native-qrcode-svg (server-side path replaces it)", () => {
    expect(activeSource).not.toMatch(/from\s+["']react-native-qrcode-svg["']/);
    expect(activeSource).not.toMatch(/<QRCode\b/);
  });

  it("HP-3: CarouselTicket interface declares optional qrImageDataUrl field", () => {
    expect(activeSource).toMatch(/qrImageDataUrl\s*\?\s*:\s*string/);
  });

  it("HP-4: renders <Image source={{ uri: ... }}> sites guarded by `imageDataUrl !== undefined && imageDataUrl.length > 0`", () => {
    const imageUsages = activeSource.match(
      /<Image\s+source=\{\{\s*uri:\s*[a-zA-Z.]+imageDataUrl/g,
    );
    expect(imageUsages).not.toBeNull();
    expect((imageUsages ?? []).length).toBe(2);

    const guards = activeSource.match(
      /imageDataUrl\s*!==\s*undefined\s*&&\s*[a-zA-Z.]+imageDataUrl\.length\s*>\s*0/g,
    );
    expect(guards).not.toBeNull();
    expect((guards ?? []).length).toBe(2);
  });

  it("HP-5: placeholder Views still render explicit qrSize dimensions when imageDataUrl absent (no layout shift)", () => {
    const placeholders = activeSource.match(
      /<View\s+style=\{\{\s*width:\s*qrSize\s*,\s*height:\s*qrSize/g,
    );
    expect(placeholders).not.toBeNull();
    expect((placeholders ?? []).length).toBe(2);
  });

  it("HP-6 (adversarial — anti-regression vs ORCH-0930 v1): mount-guard `mounted` state + useEffect MUST NOT exist (proven insufficient + replaced)", () => {
    // The component-level mount-guard was the v1 fix; it failed because the
    // bug was in SVG generation, not hydration. Re-introducing this state
    // would indicate someone reverted to a known-broken approach.
    expect(activeSource).not.toMatch(
      /const\s+\[\s*mounted\s*,\s*setMounted\s*\]\s*=\s*useState<boolean>\(\s*false\s*\)/,
    );
    expect(activeSource).not.toMatch(/setMounted\(true\)/);
  });
});

// [TEST-MOD-APPROVED #4063] The QR carousel remains covered above for the
// private surfaces that still use it. Public checkout confirmations now show
// a claim card + receipt and intentionally receive no QR material.
describe("#4063 — public confirmation screens do not expose QR material", () => {
  const tripConfirm = readFileSync(
    join(__dirname, "../../../../app/checkout-trip/[tripEventId]/confirm.tsx"),
    "utf8",
  );
  const eventConfirm = readFileSync(
    join(__dirname, "../../../../app/checkout/[eventId]/confirm.tsx"),
    "utf8",
  );
  const experienceConfirm = readFileSync(
    join(
      __dirname,
      "../../../../app/checkout-experience/[experienceEventId]/confirm.tsx",
    ),
    "utf8",
  );

  function stripCommentsLocal(value: string): string {
    return value
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^[ \t]*\/\/.*$/gm, "")
      .replace(/[ \t]\/\/[^\n]*$/gm, "");
  }

  const tripActive = stripCommentsLocal(tripConfirm);
  const eventActive = stripCommentsLocal(eventConfirm);
  const experienceActive = stripCommentsLocal(experienceConfirm);

  it.each([
    ["event", eventActive],
    ["trip", tripActive],
    ["experience", experienceActive],
  ])(
    "HP-7 (%s): renders claim and receipt while omitting the QR carousel",
    (_name, active) => {
      expect(active).toMatch(/<BuyerClaimCard/);
      expect(active).toMatch(/<BuyerCheckoutReceipt/);
      expect(active).not.toMatch(/<TicketQrCarousel/);
      expect(active).not.toMatch(/qrImageDataUrl/);
      expect(active).not.toMatch(/qrPayload/);
    },
  );
});

describe("#4063 — public OrderResult schema excludes QR secrets", () => {
  const cartContext = readFileSync(
    join(__dirname, "../CartContext.tsx"),
    "utf8",
  );

  it("HP-8: OrderResult tickets contain metadata only", () => {
    expect(cartContext).not.toMatch(/qrImageDataUrl\?\s*:\s*string/);
    expect(cartContext).not.toMatch(/qrPayload\s*:\s*string/);
    expect(cartContext).toMatch(
      /buyerContact\?\s*:\s*BuyerConfirmationContact/,
    );
    expect(cartContext).toMatch(/receipt\?\s*:\s*BuyerConfirmationReceipt/);
    expect(cartContext).toMatch(/claim\?\s*:\s*BuyerConfirmationClaim/);
  });
});
