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
 *
 * issue #2216 — THREE changes, all about making a blank pass impossible to
 * ship silently:
 *
 *   1. The import no longer hides behind a blanket `@ts-ignore` (issue #2197).
 *      See `qrcodeModule.d.ts`. The directive MUST stay on the line
 *      IMMEDIATELY above the import — a blank line or an intervening comment
 *      silently detaches it and TS2613 comes back.
 *   2. `qrPayloadToDataUrl` now VERIFIES its own output. A non-empty payload
 *      that does not yield a well-formed PNG data URI throws instead of
 *      returning something the carousel would quietly render as a white box.
 *   3. `attachQrImageDataUrls` is the ONE owner of "tickets → tickets with a
 *      QR image" for every edge function that answers a buyer with tickets
 *      (`ticket-checkout-create`, `-confirm`, `-status`). It degrades a single
 *      failed ticket to the carousel placeholder AND emits a structured error
 *      line — never a silent blank, never a failed order.
 */

// @ts-types="./qrcodeModule.d.ts"
import QRCode from "https://esm.sh/qrcode@1.5.4?bundle";

/** PNG dimensions match the carousel's qrSize (200) at 2× density for crisp render. */
const QR_PIXEL_WIDTH = 400;

/**
 * The exact prefix RN `<Image source={{ uri }} />` needs, and the exact prefix
 * `TicketQrCarousel`'s `imageDataUrl.length > 0` guard is deciding about.
 */
const PNG_DATA_URI_PREFIX = "data:image/png;base64,";

/**
 * A 400×400 QR PNG base64 body is thousands of chars; the smallest conceivable
 * real PNG is still hundreds. 100 is a floor that no truncated/placeholder/
 * error string can clear while every genuine render clears it by 40×.
 */
const MIN_PNG_BASE64_CHARS = 100;

/**
 * The post-condition, extracted so it is FALSIFIABLE.
 *
 * A guard that only ever runs behind a working library is a guard nobody can
 * prove works — which is the same class of thing as the `@ts-ignore` this
 * issue removed. Exported so `issue_2216_*` can drive it directly with the
 * shapes a broken CDN/module would actually produce (undefined, "", a bare
 * prefix, an error string, an SVG).
 *
 * @internal test seam
 */
export function assertRenderablePngDataUrl(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.startsWith(PNG_DATA_URI_PREFIX) ||
    value.length - PNG_DATA_URI_PREFIX.length < MIN_PNG_BASE64_CHARS
  ) {
    throw new Error("qr_image_generation_failed");
  }
  return value;
}

export async function qrPayloadToDataUrl(payload: string): Promise<string> {
  // Empty payloads should never reach this helper in production (tickets.qr_code
  // is NOT NULL), but if they ever do, return an empty string rather than
  // letting the underlying lib throw "No input text". The carousel's
  // `imageDataUrl.length > 0` guard treats this as "render placeholder".
  if (payload.length === 0) return "";
  const dataUrl = await QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    type: "image/png",
    width: QR_PIXEL_WIDTH,
    color: { dark: "#000000", light: "#ffffff" },
  });
  // issue #2216 — POST-CONDITION. The old code returned whatever the library
  // handed back. If the module ever resolved to something without a working
  // `toDataURL` (a CDN shape change, a bad specifier, an upstream regression),
  // the buyer got a white square and NOTHING anywhere said so. A guest cannot
  // get through a door on a white square, so an unusable image is an ERROR
  // here — the callers below decide how to degrade, but they are never handed
  // a lie.
  return assertRenderablePngDataUrl(dataUrl);
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

/**
 * attachQrImageDataUrls — the SINGLE owner of the buyer-facing
 * "ticket → ticket + rendered QR" step.
 *
 * Generic over the ticket shape on purpose: `ticket-checkout-create` carries
 * `ticketTypeId: string | null`, confirm/status carry `string`. Widening the
 * shape here would force one of them to lie about its own contract, so the
 * input row is passed through untouched and only `qrImageDataUrl` is added.
 *
 * FAILURE POSTURE (issue #2216). A QR that will not render must be LOUD but
 * must never destroy an order that was genuinely paid for and minted:
 *   - the order still returns, with `qrImageDataUrl: ""` for the one ticket
 *     that failed, so the carousel's placeholder guard takes over honestly;
 *   - a structured `level: "error"` line goes to the function log drain (and
 *     therefore to alerting), naming the ticket.
 */
export async function attachQrImageDataUrls<
  T extends { ticketId: string; qrPayload: string },
>(
  tickets: readonly T[],
): Promise<Array<T & { qrImageDataUrl: string }>> {
  return await Promise.all(
    tickets.map(async (ticket) => {
      try {
        return {
          ...ticket,
          qrImageDataUrl: await qrPayloadToDataUrl(ticket.qrPayload),
        };
      } catch (error) {
        console.error(JSON.stringify({
          ts: new Date().toISOString(),
          level: "error",
          message: "ticket_qr_image_generation_failed",
          ticketId: ticket.ticketId,
          err: error instanceof Error ? error.message : String(error),
        }));
        return { ...ticket, qrImageDataUrl: "" };
      }
    }),
  );
}
