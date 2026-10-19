// Issue #3040 — the trusted Bunny byte source for ad creatives, extracted
// verbatim from adCreativePrepare.ts (which re-exports everything here). A
// creative's video and poster are fetched only from the configured Bunny CDN
// host, at the exact path of their recorded Bunny identity, over public DNS,
// size- and time-bounded, then probed. Dependency-light on purpose: the video
// lane (apply, reaper) verifies an ad video through this module without
// loading any ad-provider adapter.
import { probeCreativeBytes, sha256Hex } from "./adCreativeProbe.ts";
import { VIDEO_LANE_FINAL_MAX_BYTES } from "./videoLaneLimits.ts";

export interface VerifiedCreativeBytes {
  video: Uint8Array;
  poster: Uint8Array;
}

export interface TrustedVideoProbe {
  bytes: VerifiedCreativeBytes;
  videoProbe: Awaited<ReturnType<typeof probeCreativeBytes>>;
  posterProbe: Awaited<ReturnType<typeof probeCreativeBytes>>;
  videoHash: string;
  posterHash: string;
}

export interface TrustedFetchDeps {
  // Same shape as adCreative.ts CreativeUploadDeps (declared here so this
  // module does not pull the provider adapters into the video lane).
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  resolveDns?: (
    hostname: string,
    recordType: "A" | "AAAA",
  ) => Promise<string[]>;
  now?: () => number;
}

export class CreativeTrustError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number, message: string) {
    super(message);
    this.name = "CreativeTrustError";
    this.code = code;
    this.status = status;
  }
}

function configuredCdnHost(): string {
  const value = (Deno.env.get("BUNNY_STREAM_CDN_HOSTNAME") ?? "").trim();
  const labels = value.split(".");
  if (
    !value || value !== value.toLowerCase() || value.includes("://") ||
    /[\/:@\s?#]/.test(value) || !/^[a-z0-9.-]+$/.test(value) ||
    value.length > 253 || labels.length < 2 ||
    labels.some((label) =>
      label.length < 1 || label.length > 63 ||
      label.startsWith("-") || label.endsWith("-")
    )
  ) {
    throw new CreativeTrustError(
      "creative_cdn_config_missing",
      503,
      "Creative media configuration is unavailable.",
    );
  }
  return value;
}

export function assertCreativeCdnConfigured(): void {
  configuredCdnHost();
}

function ipv4Blocked(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return true;
  }
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && c === 2) ||
    (a === 198 && b >= 18 && b <= 19) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
}

function ipv6Words(address: string): number[] | null {
  let input = address.toLowerCase().split("%", 1)[0];
  if (input.includes(".")) {
    const lastColon = input.lastIndexOf(":");
    const v4 = input.slice(lastColon + 1);
    const parts = v4.split(".").map(Number);
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) return null;
    input = `${input.slice(0, lastColon)}:${
      ((parts[0] << 8) | parts[1]).toString(16)
    }:${((parts[2] << 8) | parts[3]).toString(16)}`;
  }
  if ((input.match(/::/g) ?? []).length > 1) return null;
  const [leftRaw, rightRaw = ""] = input.split("::");
  const left = leftRaw ? leftRaw.split(":") : [];
  const right = rightRaw ? rightRaw.split(":") : [];
  if (!input.includes("::") && left.length !== 8) return null;
  const fill = 8 - left.length - right.length;
  if (fill < (input.includes("::") ? 1 : 0)) return null;
  const tokens = [...left, ...Array(fill).fill("0"), ...right];
  if (
    tokens.length !== 8 ||
    tokens.some((token) => !/^[0-9a-f]{1,4}$/.test(token))
  ) return null;
  return tokens.map((token) => Number.parseInt(token, 16));
}

function ipBlocked(address: string): boolean {
  const normalized = address.toLowerCase();
  if (normalized.includes(".")) {
    const mapped = normalized.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return ipv4Blocked(mapped?.[1] ?? normalized);
  }
  const words = ipv6Words(normalized);
  if (!words) return true;
  const [a, b, c, d, e, f, g, h] = words;
  const unspecifiedOrLoopback = words.slice(0, 7).every((word) => word === 0) &&
    (h === 0 || h === 1);
  const mappedV4 = words.slice(0, 5).every((word) => word === 0) &&
    f === 0xffff;
  if (mappedV4) {
    return ipv4Blocked(`${g >>> 8}.${g & 255}.${h >>> 8}.${h & 255}`);
  }
  return unspecifiedOrLoopback ||
    (a & 0xfe00) === 0xfc00 || // fc00::/7 unique-local
    (a & 0xffc0) === 0xfe80 || // fe80::/10 link-local
    (a & 0xffc0) === 0xfec0 || // fec0::/10 deprecated site-local
    (a & 0xff00) === 0xff00 || // ff00::/8 multicast
    (a === 0x0100 && b === 0 && c === 0 && d === 0) || // discard-only /64
    (a === 0x0064 && b === 0xff9b) || // IPv4 translation ranges
    (a === 0x2001 && b <= 0x01ff) || // IETF protocol assignments /23
    (a === 0x2001 && b === 0x0db8) || // documentation /32
    (a === 0x2001 && (b & 0xfff0) === 0x0020) || // ORCHIDv2 /28
    a === 0x2002 || // 6to4 transition range
    (a === 0x3fff && (b & 0xf000) === 0) || // documentation /20
    (a === 0x2620 && b === 0x004f && c === 0x8000) || // documentation /48
    (a === 0 && b === 0 && c === 0 && d === 0 && e === 0 && f === 0); // compatible v4
}

async function assertPublicDns(
  hostname: string,
  deps: TrustedFetchDeps,
): Promise<void> {
  const resolveDns = deps.resolveDns ??
    ((host: string, type: "A" | "AAAA") =>
      Deno.resolveDns(host, type) as Promise<string[]>);
  let addresses: string[] = [];
  try {
    const [v4, v6] = await Promise.all([
      resolveDns(hostname, "A").catch(() => []),
      resolveDns(hostname, "AAAA").catch(() => []),
    ]);
    addresses = [...v4, ...v6];
  } catch {
    addresses = [];
  }
  if (addresses.length === 0 || addresses.some(ipBlocked)) {
    throw new CreativeTrustError(
      "creative_source_untrusted",
      422,
      "Creative media did not resolve to a public address.",
    );
  }
}

function exactTrustedUrl(raw: string, expectedPath: string | null): URL {
  const host = configuredCdnHost();
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new CreativeTrustError(
      "creative_source_untrusted",
      422,
      "Creative media URL is invalid.",
    );
  }
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    throw new CreativeTrustError(
      "creative_source_untrusted",
      422,
      "Creative media URL is invalid.",
    );
  }
  if (
    url.protocol !== "https:" || url.username || url.password || url.port ||
    url.hash || url.search || url.hostname.toLowerCase() !== host ||
    (expectedPath !== null && decodedPath !== expectedPath)
  ) {
    throw new CreativeTrustError(
      "creative_source_untrusted",
      422,
      "Creative media URL does not match its recorded Bunny identity.",
    );
  }
  return url;
}

async function fetchBounded(
  url: URL,
  timeoutMs: number,
  maxBytes: number,
  deps: TrustedFetchDeps,
): Promise<Uint8Array> {
  await assertPublicDns(url.hostname, deps);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await (deps.fetchImpl ?? fetch)(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timer);
    throw new CreativeTrustError(
      "creative_source_unreachable",
      422,
      "Creative media could not be fetched.",
    );
  }
  if (response.status >= 300 && response.status < 400) {
    clearTimeout(timer);
    throw new CreativeTrustError(
      "creative_source_redirect_forbidden",
      422,
      "Creative media redirects are not accepted.",
    );
  }
  if (!response.ok) {
    clearTimeout(timer);
    throw new CreativeTrustError(
      "creative_source_unreachable",
      422,
      "Creative media could not be fetched.",
    );
  }
  const declared = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) {
    clearTimeout(timer);
    throw new CreativeTrustError(
      "creative_source_too_large",
      422,
      "Creative media is too large.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    clearTimeout(timer);
    throw new CreativeTrustError(
      "creative_source_unreachable",
      422,
      "Creative media has no body.",
    );
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new CreativeTrustError(
          "creative_source_too_large",
          422,
          "Creative media is too large.",
        );
      }
      chunks.push(value);
    }
  } finally {
    clearTimeout(timer);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export function constantTimeEqual(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left.toLowerCase());
  const b = new TextEncoder().encode(right.toLowerCase());
  let difference = a.byteLength ^ b.byteLength;
  const length = Math.max(a.byteLength, b.byteLength);
  for (let i = 0; i < length; i++) difference |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return difference === 0;
}

export async function probeTrustedVideoSources(
  asset: {
    bunny_video_id: string | null;
    mp4_master_url: string | null;
    poster_url: string | null;
  },
  deps: TrustedFetchDeps = {},
): Promise<TrustedVideoProbe> {
  if (
    !asset.bunny_video_id || !/^[A-Za-z0-9-]{1,128}$/.test(asset.bunny_video_id)
  ) {
    throw new CreativeTrustError(
      "creative_source_untrusted",
      422,
      "Creative video identity is invalid.",
    );
  }
  if (!asset.mp4_master_url || !asset.poster_url) {
    throw new CreativeTrustError(
      "creative_source_missing",
      422,
      "Creative video files are missing.",
    );
  }
  const videoUrl = exactTrustedUrl(
    asset.mp4_master_url,
    null,
  );
  if (
    !decodeURIComponent(videoUrl.pathname).split("/").includes(
      asset.bunny_video_id,
    )
  ) {
    throw new CreativeTrustError(
      "creative_source_untrusted",
      422,
      "Creative video URL does not contain its recorded Bunny identity.",
    );
  }
  const posterUrl = exactTrustedUrl(
    asset.poster_url,
    `/${asset.bunny_video_id}/thumbnail.jpg`,
  );
  // #3040 — the lane's processed budget is the single source for this cap.
  const video = await fetchBounded(
    videoUrl,
    60_000,
    VIDEO_LANE_FINAL_MAX_BYTES,
    deps,
  );
  const poster = await fetchBounded(posterUrl, 15_000, 10 * 1024 * 1024, deps);
  const [videoProbe, posterProbe, videoHash, posterHash] = await Promise.all([
    probeCreativeBytes(video),
    probeCreativeBytes(poster),
    sha256Hex(video),
    sha256Hex(poster),
  ]);
  if (
    videoProbe.kind !== "video" ||
    !["video/mp4", "video/quicktime"].includes(videoProbe.mimeType) ||
    !Number.isFinite(videoProbe.width) || !Number.isFinite(videoProbe.height) ||
    (videoProbe.width ?? 0) <= 0 || (videoProbe.height ?? 0) <= 0 ||
    !Number.isFinite(videoProbe.durationSeconds) ||
    videoProbe.durationSeconds === null ||
    videoProbe.durationSeconds <= 0 || video.byteLength <= 0
  ) {
    throw new CreativeTrustError(
      "creative_video_probe_failed",
      422,
      "Video bytes are not a supported MP4 or QuickTime file.",
    );
  }
  if (
    posterProbe.kind !== "image" || posterProbe.mimeType !== "image/jpeg" ||
    !Number.isFinite(posterProbe.width) ||
    !Number.isFinite(posterProbe.height) ||
    (posterProbe.width ?? 0) <= 0 || (posterProbe.height ?? 0) <= 0 ||
    poster.byteLength <= 0
  ) {
    throw new CreativeTrustError(
      "creative_poster_probe_failed",
      422,
      "Poster bytes are not a valid JPEG.",
    );
  }
  return {
    bytes: { video, poster },
    videoProbe,
    posterProbe,
    videoHash,
    posterHash,
  };
}

