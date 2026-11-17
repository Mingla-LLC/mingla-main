/**
 * offeringCalendarAction — issue #4420.
 *
 * Opens a REAL calendar entry for a public offering (the entry itself is built
 * only from real start and end instants by `offeringCalendarEntry`; a page
 * without both never shows the action). Web downloads a one-event .ics file,
 * which every calendar app opens; native opens the Google Calendar "add
 * event" page in the browser. Auth-free: safe on anonymous buyer routes.
 */

import { Linking, Platform } from "react-native";

import {
  offeringCalendarIcs,
  offeringGoogleCalendarUrl,
  type OfferingCalendarEntry,
} from "@mingla/offering-rendering/offeringCalendar";

const fileSlug = (title: string): string =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "event";

export const addOfferingToCalendar = (
  entry: OfferingCalendarEntry,
  uid: string,
): void => {
  if (Platform.OS === "web" && typeof document !== "undefined") {
    try {
      const blob = new Blob([offeringCalendarIcs(entry, uid)], {
        type: "text/calendar;charset=utf-8",
      });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `${fileSlug(entry.title)}.ics`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 0);
      return;
    } catch (error) {
      // Fall through to the Google link, which needs no file API.
      console.warn("[offeringCalendar] .ics download failed", error);
    }
  }
  Linking.openURL(offeringGoogleCalendarUrl(entry)).catch((error: unknown) => {
    console.warn("[offeringCalendar] could not open the calendar link", error);
  });
};
