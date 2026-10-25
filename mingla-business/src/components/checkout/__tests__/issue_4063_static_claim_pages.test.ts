import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..", "..", "..");
const read = (path: string): string => readFileSync(join(root, path), "utf8");

describe("#4063 public legacy pages expose pointers, not credentials", () => {
  it("rewrites the legacy RSVP route to a static claim page", () => {
    const source = read("app/rsvp/pass.tsx");
    expect(source).toContain('kind="pass"');
    expect(source).toContain("scrubFragment");
    expect(source).not.toMatch(
      /fetchPublicRsvpPass|react-native-qrcode-svg|qrCode|pdf/i,
    );
  });

  it("rewrites the legacy order route without persisted order reads", () => {
    const source = read("app/o/[orderId].tsx");
    expect(source).toContain('kind="ticket"');
    expect(source).not.toMatch(
      /useOrderStore|TicketQrCarousel|qrPayload|qrImageDataUrl/,
    );
  });

  it("keeps the shared static page credential-free and scrubs old fragments", () => {
    const source = read("src/components/checkout/StaticBuyerClaimPage.tsx");
    expect(source).toContain("window.history.replaceState");
    expect(source).toContain("BUYER_CLAIM_COPY.signInGeneric");
    expect(source).toContain("resolveGuestFunnelTarget");
    expect(source).not.toMatch(
      /token\s*=|qrPayload|qrImageDataUrl|react-native-qrcode-svg/,
    );
  });

  it("uses the shared claim card after a guest-list ticket is issued", () => {
    const source = read(
      "src/components/ticketLinks/TicketLinkLanding.tsx",
    );
    expect(source).toContain("<BuyerClaimCard");
    expect(source).toContain('shortUrl={null}');
    expect(source).toContain('handoff={null}');
    expect(source).toContain("BUYER_CLAIM_COPY.guestList.title");
    expect(source).not.toContain(
      "Each person will receive their own Mingla pass by email.",
    );
  });
});
