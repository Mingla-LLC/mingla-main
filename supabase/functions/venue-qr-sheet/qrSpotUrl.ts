// Issue #1789 (#1767 Phase 1) — the CANONICAL printed QR URL (SPEC #1788 P-10).
//
//   https://host.usemingla.com/b/{brandSlug}/v/{servingVenueSlug}?tab=menu&spot={code}&src=qr
//
// Three things about this string are load-bearing:
//
// 1. The host. `host.usemingla.com/b/*` is the ONLY host that app-opens on
//    BOTH platforms today (the business AASA grants the consumer bundle `/b/*`;
//    Android lists the host with pathPrefix `/b`), and the same URL is the
//    buyer-web page for a guest with no app. `usemingla.com`'s AASA does not
//    claim `/b` for iOS. A printed card therefore always points at PRODUCTION —
//    never a Vercel preview origin.
//
// 2. `{servingVenueSlug}` is the SERVING venue's slug, not the physical home's
//    (D-3b). A room QR opens the Brasserie's in-room menu, so the Stay page
//    needs no menu surface at all and `publicVenueService`'s stay menu-skip
//    stays exactly as it is.
//
// 3. `?tab=menu` only works because SPEC P-46 widened both venue routes to
//    accept it. Before #1789 every scan landed on Overview.
//
// Slugs are `^[a-z0-9]{1,32}$`, UNIQUE per brand, and no slug-rename RPC exists
// — which is what makes them safe to bake into something laminated.
import { PRODUCTION_BUSINESS_WEB_ORIGIN } from "../_shared/businessWebOrigin.ts";

export interface QrSpotUrlInput {
  brandSlug: string;
  servingVenueSlug: string;
  code: string;
}

export function qrSpotUrl(input: QrSpotUrlInput): string {
  const brand = encodeURIComponent(input.brandSlug);
  const venue = encodeURIComponent(input.servingVenueSlug);
  const code = encodeURIComponent(input.code);
  return `${PRODUCTION_BUSINESS_WEB_ORIGIN}/b/${brand}/v/${venue}` +
    `?tab=menu&spot=${code}&src=qr`;
}
