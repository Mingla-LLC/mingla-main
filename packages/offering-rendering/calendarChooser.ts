// issue #4420 (C2, C3) — the "Add to calendar" chooser MODEL, pure.
//
// Which calendars to offer, in what order, and the exact https / x-safari /
// intent link behind each row, for the visitor's device and browser (read from
// the user agent). No React, no DOM, no imports: the buyer page renders it
// (mingla-business AddToCalendarChooser) and Deno tests pin it.
//
// Every row is a real link opened from the tap itself (pop-up blockers allow a
// gesture-opened link), never a background download:
//   iPhone / iPad  Apple (the server .ics: iOS shows its own "Add event"),
//                  Google, Outlook
//   Android        Google, Outlook, Other calendar (.ics)
//   desktop        Google, Outlook, Apple Calendar (.ics), Other calendar (.ics)
// In-app browsers (Instagram, Facebook, TikTok) cannot download files, so:
//   iPhone         Apple hands off to Safari via x-safari-https://, plus a note
//                  and a follow-up copy-link step (the page cannot tell whether
//                  the hand-off worked)
//   Android        Other calendar opens the .ics in Chrome via an intent link

export type CalendarPlatform = "ios" | "android" | "desktop";
export type InAppBrowserName = "Instagram" | "Facebook" | "TikTok";
export type CalendarOptionId = "apple" | "google" | "outlook" | "ics";

/** How the tap opens the link: a new tab, or this tab (file, scheme or intent). */
export type CalendarOpenMode = "tab" | "navigate";

export interface CalendarOption {
  id: CalendarOptionId;
  label: string;
  sub: string;
  href: string;
  mode: CalendarOpenMode;
  /** true => after this tap, show the follow-up copy-link step. */
  followUp: boolean;
}

export interface CalendarFollowUp {
  title: string;
  body: string;
  /** The https link to copy (the server .ics). */
  copyLink: string;
}

export interface CalendarChooserModel {
  platform: CalendarPlatform;
  inApp: InAppBrowserName | null;
  /** Shown above the rows (iPhone in-app browser only). */
  note: string | null;
  options: CalendarOption[];
  followUp: CalendarFollowUp | null;
}

export interface CalendarChooserInput {
  userAgent: string;
  /** navigator.maxTouchPoints: iPadOS reports a Mac user agent. */
  maxTouchPoints?: number;
  googleUrl: string;
  outlookUrl: string;
  /** The absolute https address of the event's calendar.ics. */
  icsUrl: string;
}

export function detectCalendarPlatform(
  userAgent: string,
  maxTouchPoints: number = 0,
): CalendarPlatform {
  if (/Android/i.test(userAgent)) return "android";
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Macintosh/i.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "desktop";
}

export function detectInAppBrowser(userAgent: string): InAppBrowserName | null {
  if (/Instagram/i.test(userAgent)) return "Instagram";
  if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(userAgent)) return "Facebook";
  if (/musical_ly|BytedanceWebview|Bytedance|TikTok/i.test(userAgent)) return "TikTok";
  return null;
}

/** x-safari-https://host/path — asks an iOS in-app browser to open Safari. */
export function safariHandoffUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https:/i, "x-safari-https:");
}

/** Android intent link: open the https address in Chrome, else in this browser. */
export function chromeIntentUrl(httpsUrl: string): string {
  const url = new URL(httpsUrl);
  return (
    `intent://${url.host}${url.pathname}${url.search}` +
    `#Intent;scheme=https;package=com.android.chrome;` +
    `S.browser_fallback_url=${encodeURIComponent(httpsUrl)};end`
  );
}

const ORDER: Readonly<Record<CalendarPlatform, readonly CalendarOptionId[]>> = {
  ios: ["apple", "google", "outlook"],
  android: ["google", "outlook", "ics"],
  desktop: ["google", "outlook", "apple", "ics"],
};

export function buildCalendarChooser(input: CalendarChooserInput): CalendarChooserModel {
  const platform = detectCalendarPlatform(input.userAgent, input.maxTouchPoints ?? 0);
  const inApp = detectInAppBrowser(input.userAgent);
  const iosInApp = platform === "ios" && inApp !== null;
  const androidInApp = platform === "android" && inApp !== null;
  const desktop = platform === "desktop";

  const build = (id: CalendarOptionId): CalendarOption => {
    switch (id) {
      case "google":
        return {
          id,
          label: "Google Calendar",
          sub: "Opens Google Calendar with the event filled in",
          href: input.googleUrl,
          mode: "tab",
          followUp: false,
        };
      case "outlook":
        return {
          id,
          label: "Outlook",
          sub: "Outlook.com and Microsoft 365",
          href: input.outlookUrl,
          mode: "tab",
          followUp: false,
        };
      case "apple":
        return {
          id,
          label: desktop ? "Apple Calendar (.ics)" : "Apple Calendar",
          sub: desktop ? "Downloads the file; Calendar on Mac opens it" : "iPhone, iPad and Mac",
          href: iosInApp ? safariHandoffUrl(input.icsUrl) : input.icsUrl,
          mode: "navigate",
          followUp: iosInApp,
        };
      case "ics":
        return {
          id,
          label: desktop ? "Other calendar (.ics)" : "Other calendar",
          sub: "Downloads a calendar file",
          href: androidInApp ? chromeIntentUrl(input.icsUrl) : input.icsUrl,
          mode: "navigate",
          followUp: false,
        };
    }
  };

  return {
    platform,
    inApp,
    note: iosInApp
      ? `You're in ${inApp}'s browser. Apple Calendar opens in Safari to finish.`
      : null,
    options: ORDER[platform].map(build),
    followUp: iosInApp
      ? {
        title: `Still in ${inApp}?`,
        body:
          `Tap ••• then Open in external browser, or copy the link and paste ` +
          `it in Safari.`,
        copyLink: input.icsUrl,
      }
      : null,
  };
}
