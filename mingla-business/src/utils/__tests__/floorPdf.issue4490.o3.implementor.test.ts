/**
 * #4490 spec 08 O3 part A — openFloorPdf: on web the tab opens inside the tap
 * (before any network) and is then pointed at the signed URL; a failure closes
 * it; a refused tab is retried once, then explained. Native opens the URL with
 * the system viewer (Share › Print).
 *
 * fails-on-revert: open the tab after the fetch and W1 fails.
 */
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("react-native", () => ({ Platform: { OS: "web" }, Linking: { openURL: jest.fn() } }));
jest.mock("../../services/supabase", () => ({ supabase: { functions: { invoke: jest.fn() } } }));

// eslint-disable-next-line import/first
import { openFloorPdf } from "../floorPdf";
// eslint-disable-next-line import/first
import { StationError } from "../../services/venueStationService";

const LINK = { signedUrl: "https://storage.test/x.pdf?token=t", expiresAt: "2026-11-21T20:43:00Z", filename: "ticket.pdf" };
const REQUEST = { kind: "kitchen_ticket" as const, venueId: "v", orderId: "o", station: "kitchen" as const };

describe("08-O3 openFloorPdf", () => {
  test("W1 web: the tab opens before the PDF is fetched, then goes to the signed URL", async () => {
    const order: string[] = [];
    const tab = { location: { href: "" }, close: jest.fn() };
    const link = await openFloorPdf(REQUEST, {
      platform: "web",
      openTab: () => {
        order.push("open");
        return tab;
      },
      fetchPdf: () => {
        order.push("fetch");
        return Promise.resolve(LINK);
      },
    });
    expect(order).toEqual(["open", "fetch"]);
    expect(tab.location.href).toBe(LINK.signedUrl);
    expect(link).toEqual(LINK);
  });
  test("W2 web: a failed PDF closes the tab and keeps the server's code", async () => {
    const tab = { location: { href: "" }, close: jest.fn() };
    await expect(openFloorPdf(REQUEST, {
      platform: "web",
      openTab: () => tab,
      fetchPdf: () => Promise.reject(new StationError("floor_pdf_failed")),
    })).rejects.toMatchObject({ code: "floor_pdf_failed" });
    expect(tab.close).toHaveBeenCalled();
  });
  test("W3 web: a blocked tab is tried once more, then explained in words", async () => {
    const tabs: ({ location: { href: string }; close: () => void } | null)[] = [null, { location: { href: "" }, close: () => undefined }];
    const link = await openFloorPdf(REQUEST, { platform: "web", openTab: () => tabs.shift() ?? null, fetchPdf: () => Promise.resolve(LINK) });
    expect(link.signedUrl).toBe(LINK.signedUrl);
    await expect(openFloorPdf(REQUEST, { platform: "web", openTab: () => null, fetchPdf: () => Promise.resolve(LINK) }))
      .rejects.toMatchObject({ code: "floor_pdf_popup_blocked" });
  });
  test("N1 iOS and Android: the system viewer opens the signed URL (Share › Print)", async () => {
    const opened: string[] = [];
    await openFloorPdf({ kind: "receipt", venueId: "v", paymentId: "p" }, {
      platform: "ios",
      openUrl: (url) => {
        opened.push(url);
        return Promise.resolve(true);
      },
      fetchPdf: () => Promise.resolve(LINK),
    });
    expect(opened).toEqual([LINK.signedUrl]);
  });
});
