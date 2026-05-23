/**
 * ticketQrImage — server-side QR PNG generator for buyer-web confirm carousel.
 *
 * Background: ORCH-0930 [TicketQrCarousel React #418 hydration mismatch]
 * proved client-side `react-native-qrcode-svg` is unreliable on Expo SDK 54
 * web export. v1 (component mount-guard) + v2 (parent useEffect gate) + v3
 * (useState initializer gate) all failed: the carousel host mounts but the
 * SVG generation itself fails silently. Pivoting to server-side PNG
 * generation removes the runtime SVG dependency on web.
 *
 * Uses the same `https://esm.sh/qrcode@1.5.4?bundle` + `toDataURL` pattern
 * already validated by `_shared/ticketPdf.ts` for the printed PDF QR.
 *
 * Output: `data:image/png;base64,...` data URI string. RN `<Image source={{
 * uri }} />` displays this reliably on web, iOS, and Android — no
 * react-native-svg runtime required.
 */

// @ts-ignore -- Deno ESM import.
import QRCode from "https://esm.sh/qrcode@1.5.4?bundle";

/** PNG dimensions match the carousel's qrSize (200) at 2× density for crisp render. */
const QR_PIXEL_WIDTH = 400;

export async function qrPayloadToDataUrl(payload: string): Promise<string> {
  // Empty payloads should never reach this helper in production (tickets.qr_code
  // is NOT NULL), but if they ever do, return an empty string rather than
  // letting the underlying lib throw "No input text". The carousel's
  // `imageDataUrl.length > 0` guard treats this as "render placeholder".
  if (payload.length === 0) return "";
  return await (QRCode as unknown as {
    toDataURL: (text: string, opts: Record<string, unknown>) => Promise<string>;
  }).toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    type: "image/png",
    width: QR_PIXEL_WIDTH,
    color: { dark: "#000000", light: "#ffffff" },
  });
}

export interface TicketWithQrPayload {
  ticketId: string;
  ticketTypeId?: string;
  ticketName: string;
  qrPayload: string;
  status: string;
}

export interface TicketWithQrImage extends TicketWithQrPayload {
  qrImageDataUrl: string;
}

export async function attachQrImageDataUrls(
  tickets: TicketWithQrPayload[],
): Promise<TicketWithQrImage[]> {
  return await Promise.all(
    tickets.map(async (ticket) => ({
      ...ticket,
      qrImageDataUrl: await qrPayloadToDataUrl(ticket.qrPayload),
    })),
  );
}
