/**
 * ORCH-426 G1 — pre-serialize discover responses for hot-path serving.
 * Avoids JSON.stringify + gzip on every L1 hit under load.
 */

import type { DiscoverMergedResponse } from "./_types.ts";

export interface DiscoverResponseBytes {
  json: Uint8Array;
  gzip: Uint8Array;
}

export function wantsGzip(req: Request): boolean {
  const ae = req.headers.get("accept-encoding") ?? "";
  return /\bgzip\b/i.test(ae);
}

export function withCacheMeta(response: DiscoverMergedResponse): DiscoverMergedResponse {
  return {
    ...response,
    meta: { ...response.meta, fromCache: true },
  };
}

export async function encodeDiscoverResponse(
  response: DiscoverMergedResponse,
): Promise<DiscoverResponseBytes> {
  const json = new TextEncoder().encode(JSON.stringify(response));
  const gzip = await gzipCompress(json);
  return { json, gzip };
}

export function discoverJsonResponse(
  req: Request,
  bytes: DiscoverResponseBytes,
  corsHeaders: Record<string, string>,
): Response {
  const gzip = wantsGzip(req);
  const body = gzip && bytes.gzip.length > 0 ? bytes.gzip : bytes.json;
  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      ...(gzip && bytes.gzip.length > 0 ? { "Content-Encoding": "gzip" } : {}),
      "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
      Vary: "Accept-Encoding",
    },
  });
}

/** Serves cached bytes; decompresses gzip-only storage when client omits Accept-Encoding. */
export async function serveDiscoverBytes(
  req: Request,
  bytes: DiscoverResponseBytes,
  corsHeaders: Record<string, string>,
): Promise<Response> {
  if (wantsGzip(req) && bytes.gzip.length > 0) {
    return discoverJsonResponse(req, bytes, corsHeaders);
  }
  if (bytes.json.length > 0) {
    return discoverJsonResponse(req, bytes, corsHeaders);
  }
  const json = await gzipDecompress(bytes.gzip);
  return new Response(json, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30, stale-while-revalidate=120",
      Vary: "Accept-Encoding",
    },
  });
}

async function gzipCompress(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input]).stream().pipeThrough(new CompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

export async function gzipDecompress(input: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream("gzip"));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Gzip bytes stored in DB — no decompress needed for gzip clients. */
export function bytesFromStoredGzip(gzip: Uint8Array): DiscoverResponseBytes {
  return { json: new Uint8Array(0), gzip };
}
