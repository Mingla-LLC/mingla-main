/**
 * offeringCalendarAction — issue #4420.
 *
 * NATIVE only (Host app previews): opens the Google Calendar "add event" page
 * in the browser. The entry itself is built only from real start and end
 * instants by `offeringCalendarEntry`; a page without both never shows the
 * action. Auth-free: safe on anonymous buyer routes.
 *
 * Web does NOT come through here. Its old path built an .ics Blob and clicked a
 * hidden `<a download>`: in-app browsers (Instagram, TikTok, Facebook) ignore
 * downloads and iPhone Safari saves the file instead of opening Calendar, so
 * the tap did nothing and no error ever reached the code (#4420). Web opens the
 * chooser (components/event/useAddToCalendar), whose rows are real https links.
 */

import { Linking } from "react-native";

import {
  offeringGoogleCalendarUrl,
  type OfferingCalendarEntry,
} from "@mingla/offering-rendering/offeringCalendar.cjs";

export const addOfferingToCalendar = (entry: OfferingCalendarEntry): void => {
  Linking.openURL(offeringGoogleCalendarUrl(entry)).catch((error: unknown) => {
    console.warn("[offeringCalendar] could not open the calendar link", error);
  });
};
