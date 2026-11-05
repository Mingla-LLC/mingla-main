// Issue #4261 — link previews for chat plans (title, picture, site name).
//
// Pages are untrusted data. Every fetch goes through the shared SSRF-safe
// fetchPublicUrl (per-hop public DNS check, manual redirects re-validated);
// this module adds the preview limits: 6 s for the page including the body,
// 5 MB declared size, at most 512 KB or up to the first </head> read, and a
// 4 s HEAD probe of the picture (an image type, at most 8 MB). The picture
// URL is shown directly by the phone: no proxy, no storage, no
// /render/image/ transformations.
//
// The phone never sends a URL: the handler asks chat_plan_link_targets as
// the user (membership + which URLs need a fetch) and writes results only
// through the service-role chat_plan_link_preview_store.

import {
  assertSafePublicUrl,
  fetchPublicUrl,
  type FetchPublicUrlDeps,
} from "../_shared/agentWebResearch.ts";
import { corsHeaders } from "../_shared/cors.ts";

export const USER_AGENT = "Mingla-LinkPreview/1.0 (+https://usemingla.com)";
export const PAGE_ACCEPT = "text/html,application/xhtml+xml";
export const PAGE_TIMEOUT_MS = 6_000;
export const PAGE_MAX_REDIRECTS = 3;
export const PAGE_MAX_DECLARED_BYTES = 5 * 1024 * 1024;
export const HEAD_MAX_BYTES = 512 * 1024;
export const IMAGE_TIMEOUT_MS = 4_000;
export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const TITLE_MAX = 200;
export const SITE_MAX = 80;
export const IMAGE_URL_MAX = 1024;
export const REQUEST_BUDGET_MS = 15_000;
export const CONCURRENCY = 3;
export const MAX_TARGETS = 7;

const HTML_TYPES = new Set(["text/html", "application/xhtml+xml"]);
const IMAGE_TYPE = /^image\/(jpeg|png|webp|gif|avif)$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ParsedPreview {
  title: string | null;
  siteName: string | null;
  imageUrl: string | null;
}

export interface LinkPreviewResult extends ParsedPreview {
  outcome: "ok" | "failed";
  finalUrl: string | null;
  reason: string | null;
}

export type LinkPreviewDeps = FetchPublicUrlDeps;

// ── Text ────────────────────────────────────────────────────────────────────
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) {
        return "";
      }
      return String.fromCodePoint(code);
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function cutCodePoints(value: string, max: number): string {
  const points = Array.from(value);
  return points.length <= max ? value : points.slice(0, max).join("").trimEnd();
}

/** Decode entities, strip tags and control characters, collapse whitespace, cut. */
export function cleanText(raw: string | null | undefined, max: number): string | null {
  if (raw == null) return null;
  const text = decodeEntities(raw)
    .replace(/<[^>]*>/g, " ")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u2028-\u202E\u2066-\u2069\uFEFF]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return cutCodePoints(text, max);
}

// ── URLs ────────────────────────────────────────────────────────────────────
/** A preview target: http(s), public, and never with credentials. */
export function assertPreviewUrl(raw: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("PUBLIC_URL_INVALID");
  }
  if (parsed.username || parsed.password) throw new Error("PUBLIC_URL_CREDENTIALS");
  return assertSafePublicUrl(raw);
}

/** The picture: https, public, no credentials, at most 1024 characters. */
export function safeImageUrl(raw: string | null | undefined, base: URL | string): string | null {
  const value = cleanText(raw, 4096);
  if (!value) return null;
  let resolved: URL;
  try {
    resolved = new URL(value, base);
  } catch {
    return null;
  }
  if (resolved.protocol !== "https:") return null;
  if (resolved.username || resolved.password) return null;
  try {
    assertSafePublicUrl(resolved.toString());
  } catch {
    return null;
  }
  const out = resolved.toString();
  return out.length <= IMAGE_URL_MAX ? out : null;
}

// ── Parse ───────────────────────────────────────────────────────────────────
function attributesOf(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    const name = m[1].toLowerCase();
    if (!(name in attrs)) attrs[name] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/** Pure: reads og / twitter / <title> from an HTML head. */
export function parseLinkPreview(html: string, finalUrl: URL | string): ParsedPreview {
  const head = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  const meta = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributesOf(m[0]);
    const key = (attrs.property ?? attrs.name ?? "").trim().toLowerCase();
    if (!key || attrs.content === undefined || meta.has(key)) continue;
    meta.set(key, attrs.content);
  }
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? null;

  const title = cleanText(meta.get("og:title"), TITLE_MAX) ??
    cleanText(meta.get("twitter:title"), TITLE_MAX) ??
    cleanText(titleTag, TITLE_MAX);
  const siteName = cleanText(meta.get("og:site_name"), SITE_MAX);
  let imageUrl: string | null = null;
  for (const key of ["og:image:secure_url", "og:image", "twitter:image"]) {
    imageUrl = safeImageUrl(meta.get(key), finalUrl);
    if (imageUrl) break;
  }
  return { title, siteName, imageUrl };
}

// ── Fetch ───────────────────────────────────────────────────────────────────
function contentTypeOf(response: Response): string {
  return (response.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
}

function declaredLength(response: Response): number | null {
  const raw = response.headers.get("content-length");
  if (raw == null) return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

async function discard(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The body is already closed or errored; nothing to release.
  }
}

/** Reads the body as a stream; stops at maxBytes or at the first </head>. */
export async function readHead(response: Response, maxBytes = HEAD_MAX_BYTES): Promise<string> {
  const body = response.body;
  if (!body) return "";
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (bytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const room = maxBytes - bytes;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      bytes += chunk.byteLength;
      const from = Math.max(0, text.length - 7);
      text += decoder.decode(chunk, { stream: true });
      const end = text.toLowerCase().indexOf("</head>", from);
      if (end !== -1) {
        text = text.slice(0, end + 7);
        break;
      }
    }
    text += decoder.decode();
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

/** HEAD-probes a picture: 2xx, an image type, at most 8 MB when declared. */
export async function probeImage(imageUrl: string, deps: LinkPreviewDeps = {}): Promise<boolean> {
  try {
    const { response } = await fetchPublicUrl(new URL(imageUrl), {
      method: "HEAD",
      accept: "image/*",
      userAgent: USER_AGENT,
      timeoutMs: IMAGE_TIMEOUT_MS,
      maxRedirects: PAGE_MAX_REDIRECTS,
      signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
    }, deps);
    await discard(response);
    if (response.status < 200 || response.status > 299) return false;
    if (!IMAGE_TYPE.test(contentTypeOf(response))) return false;
    const length = declaredLength(response);
    return length === null || length <= IMAGE_MAX_BYTES;
  } catch {
    return false;
  }
}

function failed(reason: string, finalUrl: string | null = null): LinkPreviewResult {
  return { outcome: "failed", title: null, siteName: null, imageUrl: null, finalUrl, reason };
}

/** Fetches one stored link and builds its preview. Never throws. */
export async function fetchLinkPreview(rawUrl: string, deps: LinkPreviewDeps = {}): Promise<LinkPreviewResult> {
  let finalUrl: URL | null = null;
  try {
    const target = assertPreviewUrl(rawUrl);
    const signal = AbortSignal.timeout(PAGE_TIMEOUT_MS);
    const { url, response } = await fetchPublicUrl(target, {
      method: "GET",
      accept: PAGE_ACCEPT,
      userAgent: USER_AGENT,
      timeoutMs: PAGE_TIMEOUT_MS,
      maxRedirects: PAGE_MAX_REDIRECTS,
      signal,
    }, deps);
    finalUrl = url;
    if (!response.ok) {
      await discard(response);
      return failed(`http_${response.status}`, url.toString());
    }
    const length = declaredLength(response);
    if (length !== null && length > PAGE_MAX_DECLARED_BYTES) {
      await discard(response);
      return failed("too_large", url.toString());
    }
    const type = contentTypeOf(response);
    if (HTML_TYPES.has(type)) {
      const html = await readHead(response, HEAD_MAX_BYTES);
      const parsed = parseLinkPreview(html, url);
      const imageUrl = parsed.imageUrl && await probeImage(parsed.imageUrl, deps) ? parsed.imageUrl : null;
      return { outcome: "ok", ...parsed, imageUrl, finalUrl: url.toString(), reason: null };
    }
    if (IMAGE_TYPE.test(type) && url.protocol === "https:") {
      await discard(response);
      const imageUrl = length !== null && length > IMAGE_MAX_BYTES ? null : safeImageUrl(url.toString(), url);
      return { outcome: "ok", title: null, siteName: null, imageUrl, finalUrl: url.toString(), reason: null };
    }
    await discard(response);
    return failed("type_blocked", url.toString());
  } catch (error) {
    return failed(error instanceof Error ? error.message : "fetch_failed", finalUrl?.toString() ?? null);
  }
}

// ── Handler ─────────────────────────────────────────────────────────────────
export interface RpcError {
  code?: string;
  message?: string;
}

export interface PreviewStoreInput {
  url: string;
  outcome: "ok" | "failed";
  title: string | null;
  siteName: string | null;
  imageUrl: string | null;
  finalUrl: string | null;
}

export interface HandlerDeps {
  /** chat_plan_link_targets as the caller (their JWT). */
  linkTargets(authorization: string, planId: string): Promise<{ data: unknown; error: RpcError | null }>;
  /** chat_plan_link_preview_store with the service role. */
  storePreview(input: PreviewStoreInput): Promise<{ error: RpcError | null }>;
  fetchPreview(url: string): Promise<LinkPreviewResult>;
  now?: () => number;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function rpcStatus(error: RpcError): number {
  const code = error.code ?? "";
  if (code === "42501" || code === "P0002") return 403;
  if (code === "28000" || code === "PGRST301" || code === "PGRST302" || /jwt/i.test(error.message ?? "")) return 401;
  return 500;
}

async function mapConcurrent<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await task(items[index]);
    }
  }));
}

export async function handlePlanLinkPreview(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const authorization = req.headers.get("authorization");
  if (!authorization || !/^Bearer\s+\S+/i.test(authorization)) return json({ error: "unauthorized" }, 401);

  const body = await req.json().catch(() => null) as { planId?: unknown } | null;
  const planId = typeof body?.planId === "string" ? body.planId.trim() : "";
  if (!UUID.test(planId)) return json({ error: "invalid_input" }, 400);

  const targets = await deps.linkTargets(authorization, planId);
  if (targets.error) {
    const status = rpcStatus(targets.error);
    if (status === 500) console.error("[plan-link-preview] link targets failed", targets.error);
    return json({ error: status === 403 ? "not_allowed" : status === 401 ? "unauthorized" : "internal" }, status);
  }
  const rawUrls = (targets.data as { urls?: unknown } | null)?.urls;
  const urls = Array.isArray(rawUrls)
    ? rawUrls.filter((u): u is string => typeof u === "string" && u.length > 0).slice(0, MAX_TARGETS)
    : [];

  const now = deps.now ?? Date.now;
  const deadline = now() + REQUEST_BUDGET_MS;
  let fetched = 0;
  let storeFailed = false;
  await mapConcurrent(urls, CONCURRENCY, async (url) => {
    if (now() >= deadline) return;
    const preview = await deps.fetchPreview(url);
    if (now() >= deadline) return;
    const { error } = await deps.storePreview({
      url,
      outcome: preview.outcome,
      title: preview.title,
      siteName: preview.siteName,
      imageUrl: preview.imageUrl,
      finalUrl: preview.finalUrl,
    });
    if (error) {
      storeFailed = true;
      console.error("[plan-link-preview] store failed", error);
      return;
    }
    fetched += 1;
  });
  if (storeFailed) return json({ error: "internal" }, 500);
  return json({ planId, fetched, skipped: urls.length - fetched });
}
