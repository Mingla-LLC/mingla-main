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

function le16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
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
  const buildIloc = (baseOffset: number): Uint8Array =>
    box(
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
  return fromBase64(
    "UklGRjgAAABXRUJQVlA4ICwAAACQAQCdASoCAAIAAUAmJaACdLoAA5gA/uxw3/3jP/7jP/7jP/l99uxduggAAA==",
  );
}

function validJpeg(): Uint8Array {
  return fromBase64(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCAAsJJ/9k=",
  );
}

function validHeic(): Uint8Array {
  return fromBase64(
    "AAAAHGZ0eXBoZWl4AAAAAG1pZjFoZWl4bWlhZgAAAWVtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABiQABAAAAAAAAADYAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA5WlwcnAAAADGaXBjbwAAAHRodmNDAQQIAAAAAAAAAAAAHvAA/P38/AAADwNgAAEAF0ABDAH//wQIAAADAJm4AAADAAAeugJAYQABAClCAQEECAAAAwCZuAAAAwAAHqAggQRSluqumubgIaDAgAAADIAAAAMAhGIAAQAGRAHBc8GJAAAAFGlzcGUAAAAAAAAAQAAAAEAAAAAoY2xhcAAAAAIAAAABAAAAAgAAAAH////CAAAAAv///8IAAAACAAAADnBpeGkAAAAAAQwAAAAXaXBtYQAAAAAAAAABAAEEgQIEgwAAAD5tZGF0AAAAMigBrwTyFoc0cWTS3/iB/8j+VOPsvK2wSbVCOz9AUsRgJr9166BkxM0TqWzQKCuop16m",
  );
}

function classicPdf(extraObjects: Uint8Array[] = []): Uint8Array {
  const objects = [
    encoder.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    encoder.encode(
      "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    ),
    encoder.encode(
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>\nendobj\n",
    ),
    ...extraObjects,
  ];
  const header = encoder.encode("%PDF-1.7\n");
  const offsets = [0];
  let byteLength = header.length;
  for (const object of objects) {
    offsets.push(byteLength);
    byteLength += object.length;
  }
  const body = concat(header, ...objects);
  const entries = ["0000000000 65535 f "];
  for (let object = 1; object <= objects.length; object += 1) {
    entries.push(`${String(offsets[object]).padStart(10, "0")} 00000 n `);
  }
  return concat(
    body,
    encoder.encode(
      `xref\n0 ${objects.length + 1}\n${
        entries.join("\n")
      }\ntrailer\n<< /Size ${
        objects.length + 1
      } /Root 1 0 R >>\nstartxref\n${body.length}\n%%EOF`,
    ),
  );
}

function pdfWithStream(stream: Uint8Array, filter: string): Uint8Array {
  return classicPdf([
    concat(
      encoder.encode(
        `4 0 obj\n<< /Length ${stream.length} /Filter /${filter} >>\nstream\n`,
      ),
      stream,
      encoder.encode("\nendstream\nendobj\n"),
    ),
  ]);
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

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const source = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  return new Uint8Array(
    await new Response(
      new Blob([source]).stream().pipeThrough(
        new CompressionStream("deflate-raw"),
      ),
    ).arrayBuffer(),
  );
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function pngWithScanline(
  bitDepth: number,
  colorType: number,
  scanline: Uint8Array,
): Promise<Uint8Array> {
  return concat(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk(
      "IHDR",
      concat(be32(1), be32(1), new Uint8Array([bitDepth, colorType, 0, 0, 0])),
    ),
    pngChunk("IDAT", await deflate(scanline)),
    pngChunk("IEND", new Uint8Array()),
  );
}

interface TestZipEntry {
  name: string;
  compression: 0 | 8;
  compressed: Uint8Array;
  actual: Uint8Array;
  declaredUncompressedSize: number;
}

function zip(entries: TestZipEntry[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const checksum = crc32(entry.actual);
    const local = concat(
      le32(0x04034b50),
      le16(20),
      le16(0),
      le16(entry.compression),
      le16(0),
      le16(0),
      le32(checksum),
      le32(entry.compressed.length),
      le32(entry.declaredUncompressedSize),
      le16(name.length),
      le16(0),
      name,
      entry.compressed,
    );
    locals.push(local);
    central.push(concat(
      le32(0x02014b50),
      le16(20),
      le16(20),
      le16(0),
      le16(entry.compression),
      le16(0),
      le16(0),
      le32(checksum),
      le32(entry.compressed.length),
      le32(entry.declaredUncompressedSize),
      le16(name.length),
      le16(0),
      le16(0),
      le16(0),
      le16(0),
      le32(0),
      le32(localOffset),
      name,
    ));
    localOffset += local.length;
  }
  const localBytes = concat(...locals);
  const centralBytes = concat(...central);
  return concat(
    localBytes,
    centralBytes,
    le32(0x06054b50),
    le16(0),
    le16(0),
    le16(entries.length),
    le16(entries.length),
    le32(centralBytes.length),
    le32(localBytes.length),
    le16(0),
  );
}

async function forgedDocxSizeBomb(): Promise<Uint8Array> {
  const contentTypes = encoder.encode(
    '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  const document = encoder.encode(
    `<w:document><w:body><w:p><w:r><w:t>${
      "A".repeat(20 * 1024 * 1024 + 1)
    }</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip([
    {
      name: "[Content_Types].xml",
      compression: 0,
      compressed: contentTypes,
      actual: contentTypes,
      declaredUncompressedSize: contentTypes.length,
    },
    {
      name: "word/document.xml",
      compression: 8,
      compressed: await deflateRaw(document),
      actual: document,
      declaredUncompressedSize: 1,
    },
  ]);
}

function flatePdf(stream: Uint8Array): Uint8Array {
  return pdfWithStream(stream, "FlateDecode");
}

function xrefStreamPdf(): Uint8Array {
  const objects = [
    encoder.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    encoder.encode(
      "2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n",
    ),
    encoder.encode(
      "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 1 1] >>\nendobj\n",
    ),
  ];
  const header = encoder.encode("%PDF-1.7\n");
  const offsets = [0];
  let xrefOffset = header.length;
  for (const object of objects) {
    offsets.push(xrefOffset);
    xrefOffset += object.length;
  }
  const xrefData = concat(
    new Uint8Array([0]),
    be32(0),
    be16(65535),
    ...offsets.slice(1).map((offset) =>
      concat(new Uint8Array([1]), be32(offset), be16(0))
    ),
    new Uint8Array([1]),
    be32(xrefOffset),
    be16(0),
  );
  const xrefObject = concat(
    encoder.encode(
      `4 0 obj\n<< /Type /XRef /Size 5 /W [1 4 2] /Index [0 5] /Root 1 0 R /Length ${xrefData.length} >>\nstream\n`,
    ),
    xrefData,
    encoder.encode("\nendstream\nendobj\n"),
  );
  return concat(
    header,
    ...objects,
    xrefObject,
    encoder.encode(`startxref\n${xrefOffset}\n%%EOF`),
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
  const jpeg = validJpeg();
  assertEquals(
    (await verifyAriAttachment(jpeg, "image/jpeg", jpeg.length)).verifiedMime,
    "image/jpeg",
  );
  const heicFixture = validHeic();
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

Deno.test("#3429 rejects illegal PNG depth-color combinations and scanline filters", async () => {
  const illegalCombination = await pngWithScanline(
    4,
    2,
    new Uint8Array([0, 0, 0]),
  );
  await rejectsWith(illegalCombination, "image/png", "CORRUPT_FILE");
  const illegalFilter = await pngWithScanline(
    8,
    2,
    new Uint8Array([5, 0, 0, 0]),
  );
  await rejectsWith(illegalFilter, "image/png", "CORRUPT_FILE");
  const indexedWithoutPalette = await pngWithScanline(
    1,
    3,
    new Uint8Array([0, 0]),
  );
  await rejectsWith(indexedWithoutPalette, "image/png", "CORRUPT_FILE");
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

Deno.test("#3429 rejects metadata-only HEIC, token-shaped WebP, and bogus PDF xref targets", async () => {
  await rejectsWith(metadataOnlyHeic(2, 3), "image/heic", "CORRUPT_FILE");
  await rejectsWith(heic(2, 3), "image/heic", "CORRUPT_FILE");
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
  const headerOnlyLosslessWebp = concat(
    encoder.encode("RIFF"),
    le32(18),
    encoder.encode("WEBP"),
    encoder.encode("VP8L"),
    le32(5),
    new Uint8Array([0x2f, 0, 0, 0, 0, 0]),
  );
  await rejectsWith(
    headerOnlyLosslessWebp,
    "image/webp",
    "UNSUPPORTED_TYPE",
  );
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

Deno.test("#3429 verifies stored ZIP bytes instead of trusting central metadata", async () => {
  const contentTypes = encoder.encode(
    '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  const forgedChecksumSource = contentTypes.slice();
  forgedChecksumSource[0] ^= 0xff;
  const corrupt = zip([{
    name: "[Content_Types].xml",
    compression: 0,
    compressed: contentTypes,
    actual: forgedChecksumSource,
    declaredUncompressedSize: contentTypes.length,
  }]);
  await rejectsWith(
    corrupt,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "CORRUPT_FILE",
  );
});

Deno.test("#3429 bounds actual Flate PDF expansion without materializing the stream", async () => {
  const bomb = flatePdf(await deflate(new Uint8Array(20 * 1024 * 1024 + 1)));
  await rejectsWith(bomb, "application/pdf", "DECOMPRESSION_BOMB");
});

Deno.test("#3429 bounds lying DOCX sizes and RunLength PDF expansion before allocation", async () => {
  const docx = await forgedDocxSizeBomb();
  await rejectsWith(
    docx,
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "DECOMPRESSION_BOMB",
  );

  const encoded = new Uint8Array(400_001);
  for (let offset = 0; offset < encoded.length - 1; offset += 2) {
    encoded[offset] = 129;
    encoded[offset + 1] = 0x41;
  }
  encoded[encoded.length - 1] = 128;
  const pdf = pdfWithStream(encoded, "RunLengthDecode");
  await rejectsWith(pdf, "application/pdf", "DECOMPRESSION_BOMB");
});

Deno.test("#3429 rejects unsupported PDF stream filters", async () => {
  await rejectsWith(
    pdfWithStream(new Uint8Array([0]), "LZWDecode"),
    "application/pdf",
    "UNSUPPORTED_TYPE",
  );
});

Deno.test("#3429 accepts bounded structural PDF xref streams", async () => {
  const pdf = xrefStreamPdf();
  assertEquals(
    (await verifyAriAttachment(pdf, "application/pdf", pdf.length))
      .verifiedMime,
    "application/pdf",
  );
});
