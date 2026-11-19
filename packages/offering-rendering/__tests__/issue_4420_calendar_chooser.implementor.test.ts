// MINGLA-INVARIANT: I-4420-CALENDAR-ROWS-ARE-REAL-LINKS | issue #4420 | every "Add to calendar" chooser row opens a real https (or x-safari-https / intent) link built by the pure chooser model, ordered by platform; nothing depends on a background file download.
// issue #4420 C1-C3 — pure contracts: Outlook link, ICS DTSTAMP, platform order,
// in-app browser detection and the in-app hand-off links. Deno-runnable.
//
// FAILS-ON-REVERT (delete the named code, the named test goes red):
//   - offeringOutlookCalendarUrl (or its enddt/startdt/rru) ........ O-1
//   - DTSTAMP back to the event start ............................... D-1
//   - the iOS order [apple, google, outlook] ........................ P-1
//   - the Android order or the desktop (.ics) rows .................. P-2, P-3
//   - detectInAppBrowser (Instagram / FBAN / FBAV / TikTok) ........ B-1
//   - safariHandoffUrl / the iOS in-app Apple row + follow-up ....... B-2
//   - chromeIntentUrl / the Android in-app ics row .................. B-3

import { assert, assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createRequire } from "node:module";

import {
  buildCalendarChooser,
  chromeIntentUrl,
  detectCalendarPlatform,
  detectInAppBrowser,
  safariHandoffUrl,
} from "../calendarChooser.ts";

// offeringCalendar is CommonJS (one owner shared with the server route).
const { offeringCalendarEntry, offeringCalendarIcs, offeringGoogleCalendarUrl, offeringOutlookCalendarUrl } =
  createRequire(import.meta.url)("../offeringCalendar.cjs");

const entry = offeringCalendarEntry({
  title: "FoodieFantasy, By The Sea",
  startIso: "2026-12-20T14:00:00.000Z",
  endIso: "2026-12-20T19:30:00.000Z",
  location: "Jameson Yard, Lekki Phase 1",
  url: "https://host.usemingla.com/e/foodiefantasybythesea/foodiefantasy-by-the-sea",
});
assert(entry !== null);

const ICS = "https://host.usemingla.com/e/foodiefantasybythesea/foodiefantasy-by-the-sea/calendar.ics";
const UA = {
  iphoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iphoneInstagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/22A3354 Instagram 355.0.0.20.103 (iPhone16,2; iOS 18_0; en_GB; en-GB; scale=3.00; 1290x2796; 654301927)",
  iphoneTikTok:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_36.5.0 BytedanceWebview/d8a21c6",
  iphoneFacebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/480.0.0.0.0;FBBV/1;FBDV/iPhone16,2]",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  androidInstagram:
    "Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/130.0.0.0 Mobile Safari/537.36 Instagram 355.0.0.0.0 Android",
  androidFacebook:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/480.0.0.0.0;]",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

const model = (userAgent: string, maxTouchPoints = 0) =>
  buildCalendarChooser({
    userAgent,
    maxTouchPoints,
    googleUrl: offeringGoogleCalendarUrl(entry),
    outlookUrl: offeringOutlookCalendarUrl(entry),
    icsUrl: ICS,
  });
const ids = (userAgent: string, maxTouchPoints = 0) => model(userAgent, maxTouchPoints).options.map((o) => o.id);

Deno.test("O-1 the Outlook compose link carries subject, UTC start and end, location, body", () => {
  const url = new URL(offeringOutlookCalendarUrl(entry));
  assertEquals(url.origin + url.pathname, "https://outlook.live.com/calendar/0/action/compose");
  assertEquals(url.searchParams.get("subject"), "FoodieFantasy, By The Sea");
  assertEquals(url.searchParams.get("startdt"), "2026-12-20T14:00:00.000Z");
  assertEquals(url.searchParams.get("enddt"), "2026-12-20T19:30:00.000Z");
  assertEquals(url.searchParams.get("location"), "Jameson Yard, Lekki Phase 1");
  assertStringIncludes(url.searchParams.get("body") ?? "", "/e/foodiefantasybythesea/");
  assertEquals(url.searchParams.get("path"), "/calendar/action/compose");
  assertEquals(url.searchParams.get("rru"), "addevent");
  const bare = offeringCalendarEntry({ title: "X", startIso: "2026-12-20T14:00:00Z", endIso: "2026-12-20T15:00:00Z" });
  assert(!offeringOutlookCalendarUrl(bare).includes("location="));
});

Deno.test("D-1 DTSTAMP is the moment the file is made, not the event start (RFC 5545)", () => {
  const ics = offeringCalendarIcs(entry, "id@usemingla.com", Date.UTC(2026, 10, 19, 9, 30, 0));
  assertStringIncludes(ics, "DTSTAMP:20261119T093000Z\r\n");
  assertStringIncludes(ics, "DTSTART:20261220T140000Z\r\n");
  const defaulted = offeringCalendarIcs(entry, "id@usemingla.com");
  assert(!defaulted.includes("DTSTAMP:20261220T140000Z"), "never stamps the event start");
});

Deno.test("P-1 iPhone and iPad: Apple, Google, Outlook (iPadOS reports a Mac user agent)", () => {
  assertEquals(ids(UA.iphoneSafari), ["apple", "google", "outlook"]);
  assertEquals(ids(UA.macSafari, 5), ["apple", "google", "outlook"]);
  assertEquals(detectCalendarPlatform(UA.macSafari, 5), "ios");
});

Deno.test("P-2 Android: Google, Outlook, Other calendar", () => {
  assertEquals(ids(UA.androidChrome), ["google", "outlook", "ics"]);
});

Deno.test("P-3 desktop: Google, Outlook, Apple Calendar (.ics), Other calendar (.ics)", () => {
  for (const ua of [UA.macSafari, UA.windowsChrome]) {
    const m = model(ua);
    assertEquals(m.options.map((o) => o.id), ["google", "outlook", "apple", "ics"]);
    assertEquals(m.options.map((o) => o.label), [
      "Google Calendar", "Outlook", "Apple Calendar (.ics)", "Other calendar (.ics)",
    ]);
    assertEquals(m.options[2].href, ICS);
    assertEquals(m.note, null);
  }
});

Deno.test("P-4 every outside-browser row is a real https link; the ics rows are the server file", () => {
  for (const ua of [UA.iphoneSafari, UA.androidChrome, UA.macSafari]) {
    for (const o of model(ua).options) {
      assert(o.href.startsWith("https://"), `${o.id}: ${o.href}`);
      assert(!o.href.startsWith("blob:") && !o.href.startsWith("data:"), "never a blob or data link");
      if (o.id === "apple" || o.id === "ics") assertEquals(o.href, ICS);
    }
  }
});

Deno.test("B-1 in-app browsers are detected by user agent", () => {
  assertEquals(detectInAppBrowser(UA.iphoneInstagram), "Instagram");
  assertEquals(detectInAppBrowser(UA.androidInstagram), "Instagram");
  assertEquals(detectInAppBrowser(UA.iphoneFacebook), "Facebook");
  assertEquals(detectInAppBrowser(UA.androidFacebook), "Facebook");
  assertEquals(detectInAppBrowser(UA.iphoneTikTok), "TikTok");
  assertEquals(detectInAppBrowser(UA.iphoneSafari), null);
  assertEquals(detectInAppBrowser(UA.androidChrome), null);
});

Deno.test("B-2 iPhone in-app: Apple hands off to Safari, with the note and the copy-link follow-up", () => {
  const m = model(UA.iphoneInstagram);
  assertEquals(m.options.map((o) => o.id), ["apple", "google", "outlook"]);
  assertEquals(m.options[0].href, "x-safari-https://host.usemingla.com/e/foodiefantasybythesea/foodiefantasy-by-the-sea/calendar.ics");
  assertEquals(m.options[0].followUp, true);
  assertEquals(m.options[1].followUp, false);
  assertEquals(m.note, "You're in Instagram's browser. Apple Calendar opens in Safari to finish.");
  assert(m.followUp !== null);
  assertEquals(m.followUp.title, "Still in Instagram?");
  assertStringIncludes(m.followUp.body, "Tap ••• then Open in external browser");
  assertEquals(m.followUp.copyLink, ICS);
  assertEquals(model(UA.iphoneTikTok).note, "You're in TikTok's browser. Apple Calendar opens in Safari to finish.");
  assertEquals(safariHandoffUrl("https://a.b/c"), "x-safari-https://a.b/c");
  // Google and Outlook stay ordinary https links inside the app
  assert(m.options[1].href.startsWith("https://calendar.google.com/"));
  assert(m.options[2].href.startsWith("https://outlook.live.com/"));
  // outside an in-app browser there is no note and no follow-up
  const safari = model(UA.iphoneSafari);
  assertEquals(safari.note, null);
  assertEquals(safari.followUp, null);
  assertEquals(safari.options[0].followUp, false);
});

Deno.test("B-3 Android in-app: Other calendar opens the file in Chrome through an intent link", () => {
  const m = model(UA.androidInstagram);
  assertEquals(m.options.map((o) => o.id), ["google", "outlook", "ics"]);
  assertEquals(
    m.options[2].href,
    "intent://host.usemingla.com/e/foodiefantasybythesea/foodiefantasy-by-the-sea/calendar.ics" +
      "#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" +
      encodeURIComponent(ICS) + ";end",
  );
  assertEquals(m.options[2].mode, "navigate");
  assertEquals(m.note, null);
  assertEquals(m.followUp, null);
  assert(m.options[0].href.startsWith("https://calendar.google.com/"));
  assertEquals(chromeIntentUrl("https://a.b/c?x=1"), "intent://a.b/c?x=1#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=" + encodeURIComponent("https://a.b/c?x=1") + ";end");
  // plain Android Chrome keeps the https file link
  assertEquals(model(UA.androidChrome).options[2].href, ICS);
});
