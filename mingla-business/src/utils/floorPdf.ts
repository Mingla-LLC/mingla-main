/**
 * #4490 spec 08 O3 — open a floor PDF (kitchen ticket, receipt, test ticket)
 * for printing. Mingla makes the PDF on the server; the device prints it:
 *  - web: the tap opens a new tab AT ONCE (pop-up blockers allow a tab opened
 *    inside the tap), then points it at the 60-second signed URL; the browser's
 *    PDF viewer prints.
 *  - iOS / Android: Linking.openURL(signedUrl), as the QR sheet does; the system
 *    viewer's Share › Print reaches AirPrint or the Android print service.
 * Printing always takes a tap: nothing here prints by itself.
 */
import { Linking, Platform } from "react-native";

import {
  requestFloorPdf,
  StationError,
  type FloorPdfLink,
  type FloorPdfRequest,
} from "../services/venueStationService";

interface TabLike {
  location: { href: string };
  close: () => void;
  document?: { title: string; body?: { textContent: string | null } | null };
}

export interface FloorPdfDeps {
  platform?: string;
  openTab?: () => TabLike | null;
  openUrl?: (url: string) => Promise<unknown>;
  fetchPdf?: (request: FloorPdfRequest) => Promise<FloorPdfLink>;
}

const browserTab = (): TabLike | null => {
  const w = globalThis as unknown as { open?: (url: string, target: string) => TabLike | null };
  return typeof w.open === "function" ? w.open("", "_blank") : null;
};

export async function openFloorPdf(request: FloorPdfRequest, deps: FloorPdfDeps = {}): Promise<FloorPdfLink> {
  const platform = deps.platform ?? Platform.OS;
  const fetchPdf = deps.fetchPdf ?? requestFloorPdf;
  if (platform === "web") {
    // Opened synchronously, inside the tap, before any network.
    const tab = (deps.openTab ?? browserTab)();
    if (tab?.document) {
      try {
        tab.document.title = "Making the ticket…";
        if (tab.document.body) tab.document.body.textContent = "Making the ticket…";
      } catch {
        // A tab we cannot write to is still pointed at the PDF below.
      }
    }
    let link: FloorPdfLink;
    try {
      link = await fetchPdf(request);
    } catch (error) {
      tab?.close();
      throw error;
    }
    if (tab === null) {
      // The browser refused the tab: try once more with the URL itself.
      const retry = (deps.openTab ?? browserTab)();
      if (retry === null) throw new StationError("floor_pdf_popup_blocked");
      retry.location.href = link.signedUrl;
      return link;
    }
    tab.location.href = link.signedUrl;
    return link;
  }
  const link = await fetchPdf(request);
  await (deps.openUrl ?? ((url: string) => Linking.openURL(url)))(link.signedUrl);
  return link;
}
