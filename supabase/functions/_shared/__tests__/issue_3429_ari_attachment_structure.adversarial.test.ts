/** #3429 rework — executable hostile binary fixtures for the private upload gate. */

import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AriAttachmentError,
  verifyAriAttachment,
} from "../agentAttachments.ts";

const encoder = new TextEncoder();

function concat(...chunks: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(
    chunks.reduce((total, chunk) => total + chunk.length, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function be16(value: number): Uint8Array {
  return new Uint8Array([(value >>> 8) & 0xff, value & 0xff]);
}

function be32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function pngChunk(type: string, payload: Uint8Array): Uint8Array {
  const source = concat(encoder.encode(type), payload);
  let crc = 0xffffffff;
  for (const value of source) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return concat(be32(payload.length), source, be32((crc ^ 0xffffffff) >>> 0));
}

function png(width: number, height: number): Uint8Array {
  return concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk(
      "IHDR",
      concat(be32(width), be32(height), new Uint8Array([8, 2, 0, 0, 0])),
    ),
    pngChunk(
      "IDAT",
      new Uint8Array([0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0, 0, 0, 4, 0, 1]),
    ),
    pngChunk("IEND", new Uint8Array()),
  );
}

function box(type: string, payload: Uint8Array): Uint8Array {
  return concat(be32(payload.length + 8), encoder.encode(type), payload);
}

function heic(width: number, height: number): Uint8Array {
  const ftyp = box("ftyp", concat(encoder.encode("heic"), be32(0)));
  const ispe = box("ispe", concat(be32(0), be32(width), be32(height)));
  const iprp = box("iprp", box("ipco", ispe));
  return concat(ftyp, box("meta", concat(be32(0), iprp)));
}

async function rejectsWith(
  bytes: Uint8Array,
  mime: string,
  code: AriAttachmentError["code"],
): Promise<void> {
  const error = await assertRejects(
    () => verifyAriAttachment(bytes, mime, bytes.length),
    AriAttachmentError,
  );
  assertEquals(error.code, code);
}

Deno.test("#3429 rejects malformed JPEG bytes rather than accepting matching bookends", async () => {
  const malformed = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
  await rejectsWith(malformed, "image/jpeg", "CORRUPT_FILE");
});

Deno.test("#3429 accepts bounded structural JPEG and HEIC fixtures", async () => {
  const jpeg = concat(
    new Uint8Array([0xff, 0xd8, 0xff, 0xc0]),
    be16(8),
    new Uint8Array([8]),
    be16(1),
    be16(1),
    new Uint8Array([1, 0xff, 0xda]),
    be16(2),
    new Uint8Array([0xff, 0xd9]),
  );
  assertEquals(
    (await verifyAriAttachment(jpeg, "image/jpeg", jpeg.length)).verifiedMime,
    "image/jpeg",
  );
  const heicFixture = heic(2, 3);
  assertEquals(
    (await verifyAriAttachment(heicFixture, "image/heic", heicFixture.length))
      .verifiedMime,
    "image/heic",
  );
});

Deno.test("#3429 rejects declared image decode bombs across PNG and HEIC", async () => {
  const oversizedPng = png(100_000, 100_000);
  await rejectsWith(oversizedPng, "image/png", "DECOMPRESSION_BOMB");
  const oversizedHeic = heic(100_000, 100_000);
  await rejectsWith(oversizedHeic, "image/heic", "DECOMPRESSION_BOMB");
});

Deno.test("#3429 rejects corrupt PNG chunks and oversized PDF streams before projection", async () => {
  const truncatedPng = concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    be32(13),
    encoder.encode("IHDR"),
  );
  await rejectsWith(truncatedPng, "image/png", "UPLOAD_INCOMPLETE");
  const pdfBomb = encoder.encode(
    "%PDF-1.7\n1 0 obj << /Length 20971521 >>\nstream\nx\nendstream\nendobj\nxref\n0 1\n0000000000 65535 f\nstartxref\n0\n%%EOF",
  );
  await rejectsWith(pdfBomb, "application/pdf", "DECOMPRESSION_BOMB");
});
