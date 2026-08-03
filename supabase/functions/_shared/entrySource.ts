export type EntrySource =
  | "ad"
  | "search"
  | "social"
  | "organic"
  | "direct"
  | "unknown";

const SEARCH_DOMAINS: readonly string[] = [
  "google.com", "google.co.uk", "google.de", "google.fr", "google.es",
  "google.it", "google.nl", "google.ca", "google.com.au", "google.co.in",
  "google.co.jp", "google.com.br", "google.ru", "google.pl", "google.ie",
  "google.com.ng", "google.co.za", "google.com.mx", "google.co.kr",
  "google.com.tr", "google.se", "google.ch", "bing.com", "duckduckgo.com",
  "yahoo.com", "search.yahoo.com", "yahoo.co.uk", "yahoo.co.jp",
  "ecosia.org", "baidu.com", "yandex.com", "yandex.ru", "qwant.com",
  "startpage.com", "ask.com", "aol.com", "naver.com", "seznam.cz",
  "search.brave.com",
];

const SOCIAL_DOMAINS: readonly string[] = [
  "instagram.com", "instagr.am", "tiktok.com", "facebook.com", "fb.com",
  "fb.me", "m.facebook.com", "messenger.com", "twitter.com", "x.com",
  "t.co", "snapchat.com", "reddit.com", "threads.net", "youtube.com",
  "youtu.be", "linkedin.com", "lnkd.in", "pinterest.com", "pin.it",
  "whatsapp.com", "wa.me", "telegram.org", "t.me", "discord.com",
  "tumblr.com", "twitch.tv", "weibo.com",
];

const MINGLA_SUFFIXES: readonly string[] = ["usemingla.com", "mingla.app"];

export function deriveReferrerHost(referrer: unknown): string | null {
  if (typeof referrer !== "string") return null;
  const raw = referrer.trim();
  if (raw.length === 0) return null;
  let host = "";
  try {
    host = new URL(raw).hostname;
  } catch {
    host = "";
  }
  if (host.length === 0) {
    host = raw
      .replace(/^[a-z][a-z0-9+.-]*:\/\//i, "")
      .split("/")[0]
      .split("?")[0]
      .split("#")[0];
    const at = host.lastIndexOf("@");
    if (at >= 0) host = host.slice(at + 1);
    const colon = host.indexOf(":");
    if (colon >= 0) host = host.slice(0, colon);
  }
  host = host.trim().toLowerCase();
  if (host.startsWith("www.")) host = host.slice(4);
  return host.length > 0 && host.length <= 253 && /^[a-z0-9.-]+$/.test(host)
    ? host
    : null;
}

function matchesDomain(host: string, domains: readonly string[]): boolean {
  return domains.some((domain) =>
    host === domain || host.endsWith(`.${domain}`)
  );
}

export function classifyEntrySource(input: {
  hasAdSignal: boolean;
  referrerHost: string | null;
}): EntrySource {
  if (input.hasAdSignal) return "ad";
  const host = input.referrerHost;
  if (host === null) return "direct";
  if (matchesDomain(host, MINGLA_SUFFIXES)) return "organic";
  if (matchesDomain(host, SEARCH_DOMAINS)) return "search";
  if (matchesDomain(host, SOCIAL_DOMAINS)) return "social";
  return "unknown";
}
