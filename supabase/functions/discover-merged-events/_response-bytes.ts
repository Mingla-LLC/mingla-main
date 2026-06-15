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
  return new Response(gzip ? bytes.gzip : bytes.json, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      ...(gzip ? { "Content-Encoding": "gzip" } : {}),
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
