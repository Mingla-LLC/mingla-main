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

function le32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
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
  // Version-zero iloc: one item, one two-byte extent in the following mdat.
  // Its base offset is the absolute start of that mdat payload (106 bytes).
  const iloc = box(
    "iloc",
    concat(
      be32(0),
      new Uint8Array([0x44, 0x40]),
      be16(1),
      be16(1),
      be16(0),
      be32(106),
      be16(1),
      be32(0),
      be32(2),
    ),
  );
  return concat(
    ftyp,
    box("meta", concat(be32(0), iprp, iloc)),
    box("mdat", new Uint8Array([0, 1])),
  );
}

function metadataOnlyHeic(width: number, height: number): Uint8Array {
  const ftyp = box("ftyp", concat(encoder.encode("heic"), be32(0)));
  const ispe = box("ispe", concat(be32(0), be32(width), be32(height)));
  return concat(
    ftyp,
    box("meta", concat(be32(0), box("iprp", box("ipco", ispe)))),
  );
}

function heicV1(width: number, height: number): Uint8Array {
  const ftyp = box("ftyp", concat(encoder.encode("heic"), be32(0)));
  const ispe = box("ispe", concat(be32(0), be32(width), be32(height)));
  const iprp = box("iprp", box("ipco", ispe));
  const iloc = box(
    "iloc",
    concat(
      be32(0x01000000),
      new Uint8Array([0x44, 0x40]),
      be16(1),
      be16(1),
      be16(0),
      be16(0),
      be32(108),
      be16(1),
      be32(0),
      be32(2),
    ),
  );
  return concat(
    ftyp,
    box("meta", concat(be32(0), iprp, iloc)),
    box("mdat", new Uint8Array([0, 1])),
  );
}

function heicVersionedWithIndex(
  version: 1 | 2,
  width: number,
  height: number,
): Uint8Array {
  const ftyp = box("ftyp", concat(encoder.encode("heic"), be32(0)));
  const ispe = box("ispe", concat(be32(0), be32(width), be32(height)));
  const iprp = box("iprp", box("ipco", ispe));
  const buildIloc = (baseOffset: number): Uint8Array => box(
    "iloc",
    concat(
      be32(version << 24),
      new Uint8Array([0x44, 0x42]),
      version === 1 ? be16(1) : be32(1),
      version === 1 ? be16(1) : be32(1),
      be16(0),
      be16(0),
      be32(baseOffset),
      be16(1),
      be16(7),
      be32(0),
      be32(2),
    ),
  );
  const placeholder = buildIloc(0);
  const mediaPayloadOffset = ftyp.length + 8 + 4 + iprp.length +
    placeholder.length + 8;
  return concat(
    ftyp,
    box("meta", concat(be32(0), iprp, buildIloc(mediaPayloadOffset))),
    box("mdat", new Uint8Array([0, 1])),
  );
}

function heicV1WithIdat(width: number, height: number): Uint8Array {
  const ftyp = box("ftyp", concat(encoder.encode("heic"), be32(0)));
  const ispe = box("ispe", concat(be32(0), be32(width), be32(height)));
  const iprp = box("iprp", box("ipco", ispe));
  const iloc = box(
    "iloc",
    concat(
      be32(0x01000000),
      new Uint8Array([0x44, 0x40]),
      be16(1),
      be16(1),
      be16(1),
      be16(0),
      be32(0),
      be16(1),
      be32(0),
      be32(2),
    ),
  );
  return concat(
    ftyp,
    box(
      "meta",
      concat(be32(0), iprp, iloc, box("idat", new Uint8Array([0, 1]))),
    ),
  );
}

function heicWithInvalidSecondExtent(): Uint8Array {
  const ftyp = box("ftyp", concat(encoder.encode("heic"), be32(0)));
  const ispe = box("ispe", concat(be32(0), be32(2), be32(3)));
  const iprp = box("iprp", box("ipco", ispe));
  const iloc = box(
    "iloc",
    concat(
      be32(0),
      new Uint8Array([0x44, 0x40]),
      be16(1),
      be16(1),
      be16(0),
      be32(114),
      be16(2),
      be32(0),
      be32(1),
      be32(100),
      be32(1),
    ),
  );
  return concat(
    ftyp,
    box("meta", concat(be32(0), iprp, iloc)),
    box("mdat", new Uint8Array([0, 1])),
  );
}

function validWebp(): Uint8Array {
  const vp8x = concat(
    encoder.encode("VP8X"),
    le32(10),
    new Uint8Array([0, 0, 0, 0, 1, 0, 0, 1, 0, 0]),
  );
  const vp8l = concat(
    encoder.encode("VP8L"),
    le32(5),
    new Uint8Array([0x2f, 0, 0, 0, 0]),
  );
  const padding = new Uint8Array([0]);
  return concat(
    encoder.encode("RIFF"),
    le32(vp8x.length + vp8l.length + padding.length + 4),
    encoder.encode("WEBP"),
    vp8x,
    vp8l,
    padding,
  );
}

function pdfWithXref(prefix: string): Uint8Array {
  return encoder.encode(
    `${prefix}xref\n0 1\n0000000000 65535 f\nstartxref\n${prefix.length}\n%%EOF`,
  );
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const source = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Uint8Array(
    await new Response(
      new Blob([source]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
}

function flatePdf(stream: Uint8Array): Uint8Array {
  const prefix = encoder.encode(
    `%PDF-1.7\n1 0 obj << /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`,
  );
  const between = encoder.encode("\nendstream\nendobj\n");
  const xrefOffset = prefix.length + stream.length + between.length;
  return concat(
    prefix,
    stream,
    between,
    encoder.encode(
      `xref\n0 1\n0000000000 65535 f\nstartxref\n${xrefOffset}\n%%EOF`,
    ),
  );
}

function xrefStreamPdf(): Uint8Array {
  const prefix = "%PDF-1.7\n1 0 obj << /Type /Page >>\nendobj\n";
  const xrefOffset = prefix.length;
  return encoder.encode(
    `${prefix}2 0 obj << /Type /XRef /W [1 2 1] /Length 4 >>\nstream\n\x00\x00\x00\x00\nendstream\nendobj\nstartxref\n${xrefOffset}\n%%EOF`,
  );
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
  const heicV1Fixture = heicV1(2, 3);
  assertEquals(
    (await verifyAriAttachment(
      heicV1Fixture,
      "image/heic",
      heicV1Fixture.length,
    ))
      .verifiedMime,
    "image/heic",
  );
  for (const fixture of [
    heicVersionedWithIndex(1, 2, 3),
    heicVersionedWithIndex(2, 2, 3),
    heicV1WithIdat(2, 3),
  ]) {
    assertEquals(
      (await verifyAriAttachment(fixture, "image/heic", fixture.length))
        .verifiedMime,
      "image/heic",
    );
  }
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
  const pdfBomb = pdfWithXref(
    "%PDF-1.7\n1 0 obj << /Length 20971521 >>\nstream\nx\nendstream\nendobj\n",
  );
  await rejectsWith(pdfBomb, "application/pdf", "DECOMPRESSION_BOMB");
});

Deno.test("#3429 rejects metadata-only HEIC, token-shaped WebP, and bogus PDF xref targets", async () => {
  await rejectsWith(metadataOnlyHeic(2, 3), "image/heic", "CORRUPT_FILE");
  await rejectsWith(
    heicWithInvalidSecondExtent(),
    "image/heic",
    "CORRUPT_FILE",
  );
  const tokenShapedWebp = concat(
    encoder.encode("RIFF"),
    le32(12),
    encoder.encode("WEBP"),
    encoder.encode("JUNK"),
    le32(0),
  );
  await rejectsWith(tokenShapedWebp, "image/webp", "CORRUPT_FILE");
  const webp = validWebp();
  assertEquals(
    (await verifyAriAttachment(webp, "image/webp", webp.length)).verifiedMime,
    "image/webp",
  );
  const bogusXref = encoder.encode(
    "%PDF-1.7\n1 0 obj << /Type /Page >>\nendobj\nxref\n0 1\n0000000000 65535 f\nstartxref\n0\n%%EOF",
  );
  await rejectsWith(bogusXref, "application/pdf", "CORRUPT_FILE");
});

Deno.test("#3429 bounds actual Flate PDF expansion without materializing the stream", async () => {
  const bomb = flatePdf(await deflate(new Uint8Array(20 * 1024 * 1024 + 1)));
  await rejectsWith(bomb, "application/pdf", "DECOMPRESSION_BOMB");
});

Deno.test("#3429 accepts bounded structural PDF xref streams", async () => {
  const pdf = xrefStreamPdf();
  assertEquals(
    (await verifyAriAttachment(pdf, "application/pdf", pdf.length))
      .verifiedMime,
    "application/pdf",
  );
});
