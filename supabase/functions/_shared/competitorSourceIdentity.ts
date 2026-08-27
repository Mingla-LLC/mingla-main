export type CompetitorSourceKind = "website" | "instagram" | "tiktok";
export interface NormalizedCompetitorSource { kind: CompetitorSourceKind; normalizedUrl: string; normalizedIdentity: string; capability: "analyzed_weekly" | "link_only"; sourceFingerprint: string; }
const RESERVED_IG = new Set(["p", "reel", "reels", "stories", "explore", "accounts", "direct", "tv"]);
const PRIVATE_V4 = /^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.|0\.)/;

async function sha256(value: string): Promise<string> { const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)); return [...new Uint8Array(bytes)].map((v) => v.toString(16).padStart(2, "0")).join(""); }
function rejectHost(url: URL): void { const host = url.hostname.toLowerCase(); if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") || PRIVATE_V4.test(host) || host === "::1" || /^\[/.test(host) || /^\d+(?:\.\d+){3}$/.test(host)) throw new Error("invalid_source"); }

export async function normalizeCompetitorSource(kind: CompetitorSourceKind, raw: string): Promise<NormalizedCompetitorSource> {
  if (typeof raw !== "string" || raw.length > 2048) throw new Error("invalid_source");
  let url: URL; try { url = new URL(raw.trim()); } catch { throw new Error("invalid_source"); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.hash) throw new Error("invalid_source");
  rejectHost(url);
  let normalizedUrl: string; let normalizedIdentity: string;
  if (kind === "website") {
    url.hostname = url.hostname.toLowerCase(); if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) url.port = "";
    const query = [...url.searchParams.entries()].filter(([key]) => !/^utm_/i.test(key) && !["gclid", "fbclid"].includes(key.toLowerCase())).sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv)); url.search = ""; for (const [key, value] of query) url.searchParams.append(key, value);
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/$/, ""); normalizedUrl = url.toString().replace(/\/$/, ""); normalizedIdentity = `website:${url.host}${url.pathname}${url.search}`;
  } else if (kind === "instagram") {
    if (!/^(?:www\.)?instagram\.com$/i.test(url.hostname) || url.search) throw new Error("invalid_source"); const parts = url.pathname.split("/").filter(Boolean); const handle = parts[0]?.toLowerCase() ?? ""; if (parts.length !== 1 || RESERVED_IG.has(handle) || !/^[a-z0-9._]{1,30}$/.test(handle)) throw new Error("invalid_source"); normalizedUrl = `https://www.instagram.com/${handle}/`; normalizedIdentity = `instagram:${handle}`;
  } else {
    if (!/^(?:www\.)?tiktok\.com$/i.test(url.hostname) || url.search) throw new Error("invalid_source"); const parts = url.pathname.split("/").filter(Boolean); const handle = parts[0]?.toLowerCase() ?? ""; if (parts.length !== 1 || !/^@[a-z0-9._]{2,24}$/.test(handle)) throw new Error("invalid_source"); normalizedUrl = `https://www.tiktok.com/${handle}`; normalizedIdentity = `tiktok:${handle.slice(1)}`;
  }
  const capability = kind === "tiktok" ? "link_only" : "analyzed_weekly";
  return { kind, normalizedUrl, normalizedIdentity, capability, sourceFingerprint: await sha256(`${kind}\n${normalizedIdentity}\n1`) };
}

export async function normalizeCompetitorSources(raw: unknown): Promise<NormalizedCompetitorSource[]> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 3) throw new Error("invalid_sources"); const seen = new Set<string>(); const output: NormalizedCompetitorSource[] = [];
  for (const item of raw) { if (!item || typeof item !== "object") throw new Error("invalid_sources"); const kind = (item as { kind?: unknown }).kind; const url = (item as { url?: unknown }).url; if ((kind !== "website" && kind !== "instagram" && kind !== "tiktok") || typeof url !== "string" || seen.has(kind)) throw new Error("invalid_sources"); seen.add(kind); output.push(await normalizeCompetitorSource(kind, url)); }
  return output;
}
