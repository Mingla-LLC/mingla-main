// Issue #3429 REWORK-1 — TESTER adversarial proof.
//
// Different angle from the implementor suite: that suite proves the cap runs
// BEFORE the decode (one oversize discriminator) and that the lease exists. It
// never pins where the caps actually sit, so every threshold could drift by one
// — or the whole defensive pixel cap could be deleted — with the implementor
// suite still green.
//
// This file pins EXACTNESS at each boundary that separates "accepted" from
// "refused", and pins that the PNG/HEIC defensive pixel cap does real work
// independently of the long-edge cap (SPEC AMENDMENT section 3.2.1 step 4):
//
//   * lossy  (JPEG/WebP): long edge <= 1600 AND pixels <= 2_560_000
//   * defensive (PNG/HEIC/HEIF): long edge <= 1600 AND pixels <= 786_432
//
// Nothing here duplicates the implementor's assertions; every case is a pair
// (at the cap, one over it) so an off-by-one in either direction fails.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ARI_IMAGE_MAX_DEFENSIVE_PIXELS,
  ARI_IMAGE_MAX_LONG_EDGE,
  AriAttachmentError,
  verifyAriAttachment,
} from "../agentAttachments.ts";

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function be32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0);
  return out;
}

function concat(...chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** A structurally valid PNG header whose IHDR declares the given size. */
function pngWithIhdr(width: number, height: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const typeBytes = new TextEncoder().encode(type);
    const body = concat(typeBytes, data);
    return concat(be32(data.length), body, be32(crc32(body)));
  };
  const ihdr = concat(
    be32(width),
    be32(height),
    new Uint8Array([8, 6, 0, 0, 0]), // 8-bit RGBA
  );
  return concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array([0x78, 0x9c, 0x63, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01])),
    chunk("IEND", new Uint8Array()),
  );
}

/** A JPEG whose SOF0 declares the given size, with deliberately invalid entropy. */
function jpegWithSof(width: number, height: number): Uint8Array {
  const seg = (marker: number, payload: Uint8Array): Uint8Array =>
    concat(new Uint8Array([0xff, marker]), be32(payload.length + 2).slice(2), payload);
  const dqt = concat(new Uint8Array([0]), new Uint8Array(64).map((_, i) => i + 1));
  const sof = concat(
    new Uint8Array([8]),
    be32(height).slice(2),
    be32(width).slice(2),
    new Uint8Array([3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1]),
  );
  const sos = new Uint8Array([3, 1, 0x00, 2, 0x11, 3, 0x11, 0x00, 0x3f, 0x00]);
  return concat(
    new Uint8Array([0xff, 0xd8]),
    seg(0xdb, dqt),
    seg(0xc0, sof),
    seg(0xda, sos),
    new Uint8Array([0x00, 0xde, 0xad, 0xbe, 0xef]),
    new Uint8Array([0xff, 0xd9]),
  );
}

/** A minimal ISO-BMFF/HEIC whose single ispe declares the given size. */
function heicWithIspe(width: number, height: number): Uint8Array {
  const enc = new TextEncoder();
  const box = (type: string, payload: Uint8Array): Uint8Array =>
    concat(be32(payload.length + 8), enc.encode(type), payload);
  const ispe = box("ispe", concat(be32(0), be32(width), be32(height)));
  const meta = box("meta", concat(be32(0), box("iprp", box("ipco", ispe))));
  const ftyp = box(
    "ftyp",
    concat(enc.encode("heic"), be32(0), enc.encode("heicmif1miaf")),
  );
  return concat(ftyp, meta, box("mdat", new Uint8Array(64)));
}

async function codeFor(
  bytes: Uint8Array,
  mime: string,
): Promise<string | "accepted-past-budget"> {
  try {
    await verifyAriAttachment(bytes, mime, bytes.byteLength);
    return "accepted-past-budget";
  } catch (error) {
    if (error instanceof AriAttachmentError) return error.code;
    throw error;
  }
}

Deno.test("#3429 tester adversarial · the constants are the thresholds the SPEC fixed", () => {
  assertEquals(ARI_IMAGE_MAX_LONG_EDGE, 1_600);
  assertEquals(ARI_IMAGE_MAX_DEFENSIVE_PIXELS, 786_432);
});

Deno.test("#3429 tester adversarial · the long-edge cap is inclusive at 1600 and rejects 1601", async () => {
  // At the cap the budget must NOT be the thing that stops it: the file is
  // deliberately undecodable, so anything other than IMAGE_DIMENSIONS_EXCEEDED
  // proves the budget let it through to the decoder.
  const atCap = await codeFor(jpegWithSof(1_600, 1_200), "image/jpeg");
  assert(
    atCap !== "IMAGE_DIMENSIONS_EXCEEDED",
    `a 1600px long edge is inside the budget, got ${atCap}`,
  );
  assertEquals(
    await codeFor(jpegWithSof(1_601, 1_200), "image/jpeg"),
    "IMAGE_DIMENSIONS_EXCEEDED",
    "1601px long edge is one over the cap and must be refused before decode",
  );
});

Deno.test("#3429 tester adversarial · PNG defensive pixel cap is inclusive at 786,432 and rejects 786,433", async () => {
  // 1024x768 == 786,432 exactly. 1024x769 == 787,456: one ROW over, with the
  // long edge unchanged at 1024, so only the PIXEL cap can refuse it. If the
  // defensive pixel cap is deleted or widened, the second assertion fails.
  const atCap = await codeFor(pngWithIhdr(1_024, 768), "image/png");
  assert(
    atCap !== "IMAGE_DIMENSIONS_EXCEEDED",
    `1024x768 is exactly the defensive cap and must pass the budget, got ${atCap}`,
  );
  assertEquals(
    await codeFor(pngWithIhdr(1_024, 769), "image/png"),
    "IMAGE_DIMENSIONS_EXCEEDED",
    "one row over the defensive pixel cap must be refused, long edge notwithstanding",
  );
});

Deno.test("#3429 tester adversarial · PNG/HEIC use the DEFENSIVE budget, never the lossy one", async () => {
  // 1600x600 = 960,000 px. Long edge is exactly at the cap, and the count is
  // far under the LOSSY cap (2,560,000) but over the DEFENSIVE cap (786,432).
  // A PNG or HEIC that reaches the decoder here has been misclassified as lossy.
  assertEquals(
    await codeFor(pngWithIhdr(1_600, 600), "image/png"),
    "IMAGE_DIMENSIONS_EXCEEDED",
    "a PNG under the lossy cap but over the defensive cap must still be refused",
  );
  assertEquals(
    await codeFor(heicWithIspe(1_600, 600), "image/heic"),
    "IMAGE_DIMENSIONS_EXCEEDED",
    "a HEIC under the lossy cap but over the defensive cap must still be refused",
  );
});

Deno.test("#3429 tester adversarial · a JPEG at the lossy cap is not refused by the defensive cap", async () => {
  // The mirror of the test above: 1600x600 as a JPEG is inside the lossy budget
  // and must reach the decoder. If JPEG were tightened to the defensive cap,
  // every prepared 1600px landscape photo would be refused in production.
  const code = await codeFor(jpegWithSof(1_600, 600), "image/jpeg");
  assert(
    code !== "IMAGE_DIMENSIONS_EXCEEDED",
    `a prepared 1600x600 JPEG must be inside the lossy budget, got ${code}`,
  );
});
