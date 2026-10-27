import type { PayloadRequest } from "payload";
import { cmsConfig } from "./config";
import { sha256 } from "./crypto";
import { readObject, writeObject } from "./objectStore";
import type { CachedFace, FontPipelineDeps, TtfPipelineDeps } from "./fontAssets";

/*
 * #2829 AD-3 — where the font pipeline keeps things: files in the existing
 * approved-media bucket under `fonts/<sha256>.woff2` (no new bucket; the key
 * is the content digest, never anything from a request), and the face list
 * per family request in the shared `font-assets` collection.
 */

const DIGEST = /^[0-9a-f]{64}$/;

export function fontObjectKey(digest: string): string {
  if (!DIGEST.test(digest)) throw new Error("FONT_DIGEST_INVALID");
  return `fonts/${digest}.woff2`;
}

/** #2829 W11 — where a TrueType preview file lives (native app specimens). */
export function ttfObjectKey(digest: string): string {
  if (!DIGEST.test(digest)) throw new Error("FONT_DIGEST_INVALID");
  return `fonts/${digest}.ttf`;
}

export function payloadTtfPipeline(req: PayloadRequest): TtfPipelineDeps {
  const base = payloadFontPipeline(req);
  return {
    fetch: base.fetch,
    cachedFaces: base.cachedFaces,
    saveFaces: base.saveFaces,
    storeTtf: (digest, bytes) => writeObject(cmsConfig().approvedBucket, ttfObjectKey(digest), bytes, "font/ttf"),
  };
}

export function payloadFontPipeline(req: PayloadRequest): FontPipelineDeps {
  // A configuration that does not declare Google Fonts (a test double, a
  // stripped-down tool) fetches nothing: every chosen family then falls back
  // to the design's, with a warning, exactly as if Google were unreachable.
  const configured = (cmsConfig() as { googleFonts?: unknown }).googleFonts !== undefined;
  return {
    fetch: configured
      ? (input, init) => fetch(input, init)
      : async () => {
        throw new Error("FONT_FETCH_NOT_CONFIGURED");
      },
    storeFont: (digest, bytes) =>
      writeObject(cmsConfig().approvedBucket, fontObjectKey(digest), bytes, "font/woff2"),
    cachedFaces: async (requestKey) => {
      const found = await req.payload.find({
        collection: "font-assets",
        overrideAccess: true,
        depth: 0,
        limit: 200,
        pagination: false,
        where: { request_key: { equals: requestKey } },
      });
      const faces = (found.docs as unknown as Array<Record<string, unknown>>).map((doc) => ({
        family: String(doc.family),
        weight: Number(doc.weight),
        style: doc.style === "italic" ? "italic" : "normal",
        unicode_range: String(doc.unicode_range ?? ""),
        digest: String(doc.digest),
        bytes: Number(doc.bytes),
      } satisfies CachedFace));
      return faces.length ? faces : null;
    },
    saveFaces: async (requestKey, faces) => {
      for (const face of faces) {
        await req.payload.create({
          collection: "font-assets",
          overrideAccess: true,
          data: { request_key: requestKey, ...face },
        });
      }
    },
  };
}

/** Reads a stored font file and proves it is the file its digest names. */
export async function readFontFile(digest: string, format: "woff2" | "ttf" = "woff2"): Promise<Uint8Array> {
  const bytes = await readObject(cmsConfig().approvedBucket, format === "ttf" ? ttfObjectKey(digest) : fontObjectKey(digest));
  if (await sha256(bytes) !== digest) throw new Error("FONT_DIGEST_MISMATCH");
  return bytes;
}
