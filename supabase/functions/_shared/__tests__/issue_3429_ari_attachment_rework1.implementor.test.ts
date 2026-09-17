// Issue #3429 REWORK-1 implementor proof (SPEC AMENDMENT section 7):
// derivative MIME, non-blaming copy, cap-before-decode ordering, the processing
// lease, one-file finalize, ISO-BMFF box sizes, the linear base64 encoder, the
// DOCX central-directory cap, image-bearing and indirect-length PDFs, and the
// orphaned-turn sweep. Every seam below executes the real shipped module.

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AriAttachmentError,
  base64FromBytes,
  verifyAriAttachment,
} from "../agentAttachments.ts";
import {
  ARI_ATTACHMENT_FAILURE_COPY,
  ariAttachmentStatus,
  finalizeAriAttachment,
  handleAriAttachmentLifecycle,
  stableFailureMessage,
} from "../agentAttachmentFinalize.ts";
import {
  loadAriTurnStatus,
  sweepInterruptedAriTurnAttempt,
} from "../agentTurnSweep.ts";

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

function be32(value: number): Uint8Array {
  return new Uint8Array([
    (value >>> 24) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 8) & 0xff,
    value & 0xff,
  ]);
}

function le16(value: number): Uint8Array {
  return new Uint8Array([value & 0xff, (value >>> 8) & 0xff]);
}

function le32(value: number): Uint8Array {
  return new Uint8Array([
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  ]);
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function rejectsWith(
  bytes: Uint8Array,
  mime: string,
  code: string,
): Promise<void> {
  const error = await assertRejects(
    () => verifyAriAttachment(bytes, mime, bytes.length),
    AriAttachmentError,
  );
  assertEquals(error.code, code);
}

// ---------------------------------------------------------------------------
// In-memory admin client: the exact supabase-js builder calls the lifecycle
// core makes, applied to real rows so conditional writes are observable.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

function comparable(value: unknown): number | string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed) && /\d{4}-\d{2}-\d{2}T/.test(value)) {
      return parsed;
    }
  }
  return value as number | string;
}

class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private mode: "select" | "update" | "upsert" = "select";
  private patch: Row = {};
  private returning = false;
  private single = false;
  private limitCount: number | null = null;

  constructor(private readonly db: FakeDb, private readonly table: string) {}

  select(_columns?: string): this {
    if (this.mode !== "select") this.returning = true;
    return this;
  }
  update(patch: Row): this {
    this.mode = "update";
    this.patch = patch;
    return this;
  }
  upsert(row: Row): this {
    this.mode = "upsert";
    this.patch = row;
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] === value);
    return this;
  }
  neq(column: string, value: unknown): this {
    this.filters.push((row) => row[column] !== value);
    return this;
  }
  is(column: string, value: null): this {
    this.filters.push((row) => (row[column] ?? null) === value);
    return this;
  }
  in(column: string, values: unknown[]): this {
    this.filters.push((row) => values.includes(row[column]));
    return this;
  }
  lt(column: string, value: unknown): this {
    this.filters.push((row) =>
      row[column] !== null && row[column] !== undefined &&
      comparable(row[column]) < comparable(value)
    );
    return this;
  }
  gte(column: string, value: unknown): this {
    this.filters.push((row) =>
      row[column] !== null && row[column] !== undefined &&
      comparable(row[column]) >= comparable(value)
    );
    return this;
  }
  order(): this {
    return this;
  }
  limit(count: number): this {
    this.limitCount = count;
    return this;
  }
  maybeSingle(): this {
    this.single = true;
    return this;
  }

  private run(): { data: unknown; error: unknown } {
    const rows = this.db.tables.get(this.table) ?? [];
    this.db.tables.set(this.table, rows);
    if (this.mode === "upsert") {
      rows.push({ ...this.patch });
      return { data: null, error: null };
    }
    let matched = rows.filter((row) => this.filters.every((f) => f(row)));
    if (this.limitCount !== null) matched = matched.slice(0, this.limitCount);
    if (this.mode === "update") {
      this.db.updates.push({ table: this.table, patch: this.patch });
      for (const row of matched) Object.assign(row, this.patch);
      if (!this.returning && !this.single) return { data: null, error: null };
    }
    const copies = matched.map((row) => ({ ...row }));
    if (this.single) return { data: copies[0] ?? null, error: null };
    return { data: copies, error: null };
  }

  then<T1 = { data: unknown; error: unknown }, T2 = never>(
    onfulfilled?:
      | ((value: { data: unknown; error: unknown }) => T1 | PromiseLike<T1>)
      | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve().then(() => this.run()).then(
      onfulfilled,
      onrejected,
    );
  }
}

class FakeDb {
  tables = new Map<string, Row[]>();
  updates: { table: string; patch: Row }[] = [];
  objects = new Map<string, Uint8Array>();
  uploads: { path: string; contentType?: string }[] = [];
  uploadError: { message: string } | null = null;
  rpcCalls: { name: string; args: Row }[] = [];

  client(): never {
    const db = this;
    return {
      from: (table: string) => new FakeQuery(db, table),
      rpc: (name: string, args: Row) => {
        db.rpcCalls.push({ name, args });
        if (name === "append_agent_activity_event") {
          const events = db.tables.get("agent_activity_events") ?? [];
          db.tables.set("agent_activity_events", events);
          events.push({
            id: `event-${events.length + 1}`,
            attempt_id: args.p_attempt_id,
            attempt_number: args.p_attempt_number,
            sequence: events.length + 1,
            event_type: args.p_event_type,
            created_at: args.p_now,
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      storage: {
        from: (_bucket: string) => ({
          download: (path: string) => {
            const bytes = db.objects.get(path);
            return Promise.resolve(
              bytes
                ? { data: new Blob([bytes.slice()]), error: null }
                : { data: null, error: { message: "not found" } },
            );
          },
          upload: (
            path: string,
            bytes: Uint8Array,
            options: { contentType?: string },
          ) => {
            db.uploads.push({ path, contentType: options.contentType });
            if (!db.uploadError) db.objects.set(path, bytes);
            return Promise.resolve({ data: null, error: db.uploadError });
          },
          remove: (_paths: string[]) =>
            Promise.resolve({ data: null, error: null }),
        }),
      },
    } as never;
  }
}

const USER = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const ATTACHMENT = "33333333-3333-4333-8333-333333333333";
const NOW = Date.parse("2026-09-17T12:00:00.000Z");

function attachmentRow(overrides: Row = {}): Row {
  return {
    id: ATTACHMENT,
    user_id: USER,
    brand_id: BRAND,
    conversation_id: null,
    client_turn_id: null,
    storage_path: `${USER}/${BRAND}/${ATTACHMENT}/source`,
    original_filename: "notes.txt",
    declared_mime: "text/plain",
    declared_size_bytes: 11,
    state: "prepared",
    failure_code: null,
    verified_mime: null,
    verified_size_bytes: null,
    file_type: "text",
    sha256: null,
    processing_token: null,
    processing_started_at: null,
    processing_attempts: 0,
    ...overrides,
  };
}

function seededDb(row: Row, source: Uint8Array): FakeDb {
  const db = new FakeDb();
  db.tables.set("agent_attachments", [row]);
  db.objects.set(row.storage_path as string, source);
  return db;
}

// ---------------------------------------------------------------------------
// (a) D-4 derivative MIME and storage rejection
// ---------------------------------------------------------------------------

Deno.test("#3429 R1 D-4: text derivatives upload as exactly text/plain and storage refusals are STORAGE_REJECTED", async () => {
  const source = encoder.encode("hello world");
  const db = seededDb(attachmentRow(), source);
  const ready = await finalizeAriAttachment(
    { admin: db.client(), userId: USER, now: () => NOW },
    ATTACHMENT,
  );
  assertEquals(ready.state, "ready");
  assertEquals(db.uploads.length, 1);
  assertEquals(db.uploads[0].contentType, "text/plain");

  const refused = seededDb(attachmentRow(), source);
  refused.uploadError = { message: "invalid_mime_type" };
  const failed = await finalizeAriAttachment(
    { admin: refused.client(), userId: USER, now: () => NOW },
    ATTACHMENT,
  );
  assertEquals(failed.state, "failed");
  assertEquals((failed as { code: string }).code, "STORAGE_REJECTED");
  assertEquals(
    (failed as { message: string }).message,
    "Ari couldn’t save notes.txt. Try again.",
  );
  assertEquals(
    refused.tables.get("agent_attachments")?.[0].failure_code,
    "STORAGE_REJECTED",
  );
});

// ---------------------------------------------------------------------------
// (b) copy: only ENCRYPTED_FILE mentions passwords; server == snapshot
// ---------------------------------------------------------------------------

Deno.test("#3429 R1 copy: no failure sentence but ENCRYPTED_FILE mentions passwords, and the server table equals the shared snapshot", async () => {
  const snapshot = JSON.parse(
    await Deno.readTextFile(
      new URL("./issue_3429_ari_failure_copy.snapshot.json", import.meta.url),
    ),
  ) as Record<string, string>;
  assertEquals({ ...ARI_ATTACHMENT_FAILURE_COPY }, snapshot);
  for (const [code, copy] of Object.entries(ARI_ATTACHMENT_FAILURE_COPY)) {
    assertEquals(
      copy.toLowerCase().includes("password"),
      code === "ENCRYPTED_FILE",
      `${code} password mention`,
    );
  }
  for (
    const code of ["CORRUPT_FILE", "UNREADABLE_FILE", "UPLOAD_INCOMPLETE", "SOMETHING_NEW"]
  ) {
    assert(
      !stableFailureMessage(code, "menu.pdf").toLowerCase().includes(
        "password",
      ),
      `${code} must not blame password protection`,
    );
  }
});

// ---------------------------------------------------------------------------
// (c) SC-R1-D5-2 cap before decode
// ---------------------------------------------------------------------------

function validJpeg(): Uint8Array {
  return fromBase64(
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCAAsJJ/9k=",
  );
}

Deno.test("#3429 R1 D-5: a 12 MP JPEG header fails IMAGE_DIMENSIONS_EXCEEDED before its invalid entropy is decoded", async () => {
  const jpeg = validJpeg().slice();
  // SOF0 payload: FF C0, length(2), precision(1), height(2), width(2).
  let sof = -1;
  for (let index = 0; index < jpeg.length - 1; index += 1) {
    if (jpeg[index] === 0xff && jpeg[index + 1] === 0xc0) {
      sof = index;
      break;
    }
  }
  assert(sof > 0, "fixture has a baseline SOF");
  jpeg[sof + 5] = 3024 >>> 8;
  jpeg[sof + 6] = 3024 & 0xff;
  jpeg[sof + 7] = 4032 >>> 8;
  jpeg[sof + 8] = 4032 & 0xff;
  // Invalid entropy: overwrite the scan payload (between SOS header and EOI)
  // with bytes that are not a decodable 4032x3024 Huffman stream.
  const eoi = jpeg.length - 2;
  let sosEnd = -1;
  for (let index = 0; index < jpeg.length - 1; index += 1) {
    if (jpeg[index] === 0xff && jpeg[index + 1] === 0xda) {
      sosEnd = index + 2 + ((jpeg[index + 2] << 8) | jpeg[index + 3]);
      break;
    }
  }
  assert(sosEnd > 0 && sosEnd < eoi, "fixture has scan data");
  jpeg.fill(0x5a, sosEnd, eoi);
  await rejectsWith(jpeg, "image/jpeg", "IMAGE_DIMENSIONS_EXCEEDED");
});

// ---------------------------------------------------------------------------
// (d) processing lease; (e) one file per finalize; concurrency
// ---------------------------------------------------------------------------

Deno.test("#3429 R1 D-5 lease: status terminalizes a processing row older than 60 s", async () => {
  const db = seededDb(
    attachmentRow({
      state: "processing",
      processing_token: "44444444-4444-4444-8444-444444444444",
      processing_started_at: new Date(NOW - 61_000).toISOString(),
      processing_attempts: 1,
    }),
    encoder.encode("hello world"),
  );
  const outcome = await ariAttachmentStatus(
    { admin: db.client(), userId: USER, now: () => NOW },
    ATTACHMENT,
  );
  assertEquals(outcome.state, "failed");
  assertEquals((outcome as { code: string }).code, "PROCESSING_INTERRUPTED");
  const row = db.tables.get("agent_attachments")![0];
  assertEquals([row.state, row.failure_code], [
    "failed",
    "PROCESSING_INTERRUPTED",
  ]);

  const fresh = seededDb(
    attachmentRow({
      state: "processing",
      processing_token: "44444444-4444-4444-8444-444444444444",
      processing_started_at: new Date(NOW - 59_000).toISOString(),
      processing_attempts: 1,
    }),
    encoder.encode("hello world"),
  );
  const live = await ariAttachmentStatus(
    { admin: fresh.client(), userId: USER, now: () => NOW },
    ATTACHMENT,
  );
  assertEquals(live.state, "processing");
});

Deno.test("#3429 R1 D-5 lease: a late ready write with a stale token changes nothing", async () => {
  const db = seededDb(attachmentRow(), encoder.encode("hello world"));
  const outcome = await finalizeAriAttachment({
    admin: db.client(),
    userId: USER,
    now: () => NOW,
    verify: async (bytes, mime, size) => {
      // While this request decodes, the lease is swept and re-owned.
      Object.assign(db.tables.get("agent_attachments")![0], {
        state: "failed",
        failure_code: "PROCESSING_INTERRUPTED",
        processing_token: "55555555-5555-4555-8555-555555555555",
      });
      return await verifyAriAttachment(bytes, mime, size);
    },
  }, ATTACHMENT);
  const row = db.tables.get("agent_attachments")![0];
  assertEquals(row.state, "failed");
  assertEquals(row.verified_mime, null);
  assertEquals(outcome.state, "failed");
  assertEquals((outcome as { code: string }).code, "PROCESSING_INTERRUPTED");
});

Deno.test("#3429 R1 D-5: finalize accepts exactly one id and a concurrent finalize never decodes twice", async () => {
  const db = seededDb(attachmentRow(), encoder.encode("hello world"));
  const deps = { admin: db.client(), userId: USER, now: () => NOW };
  const twoIds = await handleAriAttachmentLifecycle(deps, {
    action: "finalize",
    attachment_ids: [ATTACHMENT, "66666666-6666-4666-8666-666666666666"],
  });
  assertEquals(twoIds, { status: 400, body: { code: "BAD_REQUEST" } });
  const arrayWithSingle = await handleAriAttachmentLifecycle(deps, {
    action: "finalize",
    attachment_id: ATTACHMENT,
    attachment_ids: [ATTACHMENT],
  });
  assertEquals(arrayWithSingle.status, 400);

  let decodes = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => release = resolve);
  const slowDeps = {
    ...deps,
    verify: async (bytes: Uint8Array, mime: string, size: number) => {
      decodes += 1;
      await gate;
      return await verifyAriAttachment(bytes, mime, size);
    },
  };
  const first = finalizeAriAttachment(slowDeps, ATTACHMENT);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const second = await finalizeAriAttachment(slowDeps, ATTACHMENT);
  assertEquals(second.state, "processing");
  release();
  const settled = await first;
  assertEquals(settled.state, "ready");
  assertEquals(decodes, 1);
  const canonical = await handleAriAttachmentLifecycle(deps, {
    action: "status",
    attachment_id: ATTACHMENT,
  });
  assertEquals(canonical.status, 200);
  assertEquals(
    (canonical.body.outcome as { state: string }).state,
    "ready",
  );
});

// ---------------------------------------------------------------------------
// (f) D-6 ISO-BMFF box sizes
// ---------------------------------------------------------------------------

function validHeic(): Uint8Array {
  return fromBase64(
    "AAAAHGZ0eXBoZWl4AAAAAG1pZjFoZWl4bWlhZgAAAWVtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAABiQABAAAAAAAAADYAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABodmMxAAAAAA5waXRtAAAAAAABAAAA5WlwcnAAAADGaXBjbwAAAHRodmNDAQQIAAAAAAAAAAAAHvAA/P38/AAADwNgAAEAF0ABDAH//wQIAAADAJm4AAADAAAeugJAYQABAClCAQEECAAAAwCZuAAAAwAAHqAggQRSluqumubgIaDAgAAADIAAAAMAhGIAAQAGRAHBc8GJAAAAFGlzcGUAAAAAAAAAQAAAAEAAAAAoY2xhcAAAAAIAAAABAAAAAgAAAAH////CAAAAAv///8IAAAACAAAADnBpeGkAAAAAAQwAAAAXaXBtYQAAAAAAAAABAAEEgQIEgwAAAD5tZGF0AAAAMigBrwTyFoc0cWTS3/iB/8j+VOPsvK2wSbVCOz9AUsRgJr9166BkxM0TqWzQKCuop16m",
  );
}

function indexOfAscii(bytes: Uint8Array, text: string, from = 0): number {
  const needle = encoder.encode(text);
  outer: for (let start = from; start <= bytes.length - needle.length; start++) {
    for (let index = 0; index < needle.length; index += 1) {
      if (bytes[start + index] !== needle[index]) continue outer;
    }
    return start;
  }
  return -1;
}

/**
 * Returns the committed-style HEIC with an 8-byte `free` box inserted before a
 * 32-bit `mdat`, and the same file with that pair swapped for one 64-bit
 * `mdat` header. Both keep the payload at the same absolute offset, so the
 * item location stays valid and only the box-size encoding differs.
 */
function heicMdatVariants(): { freePlus32: Uint8Array; largesize: Uint8Array } {
  const original = validHeic();
  const mdatType = indexOfAscii(original, "mdat");
  const mdatStart = mdatType - 4;
  assertEquals(mdatStart + 62, original.length, "mdat is the final box");
  const payload = original.slice(mdatStart + 8);
  const head = original.slice(0, mdatStart);
  // iloc v0: payload + 4 (sizes) + 2 (count) + 2 (item) + 2 (dref) = base offset.
  const ilocPayload = indexOfAscii(head, "iloc") + 4;
  const baseOffsetAt = ilocPayload + 4 + 2 + 2 + 2 + 2;
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  assertEquals(view.getUint32(baseOffsetAt), mdatStart + 8);
  view.setUint32(baseOffsetAt, mdatStart + 16);
  const free = concat(be32(8), encoder.encode("free"));
  const freePlus32 = concat(
    head,
    free,
    be32(payload.length + 8),
    encoder.encode("mdat"),
    payload,
  );
  const largesize = concat(
    head,
    be32(1),
    encoder.encode("mdat"),
    be32(0),
    be32(payload.length + 16),
    payload,
  );
  assertEquals(freePlus32.length, largesize.length);
  return { freePlus32, largesize };
}

Deno.test("#3429 R1 D-6: a 64-bit mdat largesize and a top-level size-0 box verify; malformed sizes fail closed", async () => {
  const { freePlus32, largesize } = heicMdatVariants();
  assertEquals(
    (await verifyAriAttachment(freePlus32, "image/heic", freePlus32.length))
      .verifiedMime,
    "image/heic",
  );
  assertEquals(
    (await verifyAriAttachment(largesize, "image/heic", largesize.length))
      .verifiedMime,
    "image/heic",
  );

  const toEnd = validHeic().slice();
  const mdatStart = indexOfAscii(toEnd, "mdat") - 4;
  new DataView(toEnd.buffer).setUint32(mdatStart, 0);
  assertEquals(
    (await verifyAriAttachment(toEnd, "image/heic", toEnd.length)).verifiedMime,
    "image/heic",
  );

  const shortLargesize = largesize.slice();
  const largeAt = indexOfAscii(shortLargesize, "mdat") + 4;
  new DataView(shortLargesize.buffer).setUint32(largeAt + 4, 8);
  await rejectsWith(shortLargesize, "image/heic", "CORRUPT_FILE");

  const nestedToEnd = validHeic().slice();
  const hdlrStart = indexOfAscii(nestedToEnd, "hdlr") - 4;
  new DataView(nestedToEnd.buffer).setUint32(hdlrStart, 0);
  await rejectsWith(nestedToEnd, "image/heic", "CORRUPT_FILE");

  const tinyBox = validHeic().slice();
  new DataView(tinyBox.buffer).setUint32(hdlrStart, 4);
  await rejectsWith(tinyBox, "image/heic", "CORRUPT_FILE");
});

// ---------------------------------------------------------------------------
// (g) linear base64 encoder
// ---------------------------------------------------------------------------

function referenceBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary);
}

Deno.test("#3429 R1 section 3.4: the linear base64 encoder is byte-identical to btoa", () => {
  for (let length = 0; length <= 7; length += 1) {
    const bytes = new Uint8Array(length).map((_, index) => 250 - index * 37);
    assertEquals(base64FromBytes(bytes), referenceBase64(bytes));
  }
  const random = new Uint8Array(1024 * 1024);
  for (let offset = 0; offset < random.length; offset += 65_536) {
    crypto.getRandomValues(random.subarray(offset, offset + 65_536));
  }
  assertEquals(base64FromBytes(random), referenceBase64(random));
});

// ---------------------------------------------------------------------------
// (h) DOCX central-directory cap before any inflate
// ---------------------------------------------------------------------------

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) === 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(
    await new Response(
      new Blob([bytes.slice()]).stream().pipeThrough(
        new CompressionStream("deflate-raw"),
      ),
    ).arrayBuffer(),
  );
}

interface ZipPart {
  name: string;
  compressed: Uint8Array;
  crc: number;
  uncompressedSize: number;
}

function deflatedZip(parts: ZipPart[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = encoder.encode(part.name);
    const local = concat(
      le32(0x04034b50), le16(20), le16(0), le16(8), le16(0), le16(0),
      le32(part.crc), le32(part.compressed.length), le32(part.uncompressedSize),
      le16(name.length), le16(0), name, part.compressed,
    );
    central.push(concat(
      le32(0x02014b50), le16(20), le16(20), le16(0), le16(8), le16(0),
      le16(0), le32(part.crc), le32(part.compressed.length),
      le32(part.uncompressedSize), le16(name.length), le16(0), le16(0),
      le16(0), le16(0), le32(0), le32(offset), name,
    ));
    locals.push(local);
    offset += local.length;
  }
  const localBytes = concat(...locals);
  const centralBytes = concat(...central);
  return concat(
    localBytes, centralBytes, le32(0x06054b50), le16(0), le16(0),
    le16(parts.length), le16(parts.length), le32(centralBytes.length),
    le32(localBytes.length), le16(0),
  );
}

Deno.test("#3429 R1 D-5: a DOCX whose document.xml exceeds 3 MiB is refused from the central directory without inflating", async () => {
  const contentTypes = encoder.encode(
    '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  // 200 KB of stored bytes that claim 3 MiB + 1: ratio 16, below the bomb cap.
  const claimed = new Uint8Array(200_000);
  crypto.getRandomValues(claimed.subarray(0, 65_536));
  const docx = deflatedZip([
    {
      name: "[Content_Types].xml",
      compressed: await deflateRaw(contentTypes),
      crc: crc32(contentTypes),
      uncompressedSize: contentTypes.length,
    },
    {
      name: "word/document.xml",
      compressed: claimed,
      crc: 0,
      uncompressedSize: 3 * 1024 * 1024 + 1,
    },
  ]);
  const Original = globalThis.DecompressionStream;
  let inflates = 0;
  globalThis.DecompressionStream = class extends Original {
    constructor(format: CompressionFormat) {
      inflates += 1;
      super(format);
    }
  };
  try {
    await rejectsWith(
      docx,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "CONTEXT_LIMIT_EXCEEDED",
    );
  } finally {
    globalThis.DecompressionStream = Original;
  }
  assertEquals(inflates, 0);
});

// ---------------------------------------------------------------------------
// SC-R1-PDF-1/2 real fixtures
// ---------------------------------------------------------------------------

Deno.test("#3429 R1 PDF-1: an image-bearing PDF (opaque DCTDecode stream) reaches Ready", async () => {
  const pdf = await Deno.readFile(
    new URL("./fixtures/issue_3429/image-2048.pdf", import.meta.url),
  );
  const verified = await verifyAriAttachment(pdf, "application/pdf", pdf.length);
  assertEquals(verified.verifiedMime, "application/pdf");
  assertEquals(verified.processingMetadata.page_count, 1);
});

Deno.test("#3429 R1 PDF-2: an indirect /Length reference resolves through the xref", async () => {
  const pdf = await Deno.readFile(
    new URL("./fixtures/issue_3429/indirect-length.pdf", import.meta.url),
  );
  const verified = await verifyAriAttachment(pdf, "application/pdf", pdf.length);
  assertEquals(verified.verifiedMime, "application/pdf");

  const latin = new TextDecoder("latin1").decode(pdf);
  const lengthObject = latin.indexOf("5 0 obj\n49\nendobj");
  assert(lengthObject > 0, "fixture keeps its indirect length object");
  const wrong = pdf.slice();
  wrong.set(encoder.encode("48"), lengthObject + "5 0 obj\n".length);
  await rejectsWith(wrong, "application/pdf", "CORRUPT_FILE");
  const selfReference = pdf.slice();
  const lengthRef = latin.indexOf("/Length 5 0 R");
  selfReference.set(encoder.encode("/Length 4 0 R"), lengthRef);
  await rejectsWith(selfReference, "application/pdf", "CORRUPT_FILE");
});

// ---------------------------------------------------------------------------
// Orphaned attempt sweep (section 3.4)
// ---------------------------------------------------------------------------

function attemptRow(status: string, secondsAgo: number): Row {
  return {
    id: "attempt-3429",
    user_id: USER,
    conversation_id: "conversation-3429",
    user_message_id: "message-3429",
    client_turn_id: "turn-3429",
    attempt_number: 1,
    status,
    error_code: null,
    accepted_at: new Date(NOW - 600_000).toISOString(),
    started_at: new Date(NOW - 590_000).toISOString(),
    terminal_at: null,
    updated_at: new Date(NOW - secondsAgo * 1_000).toISOString(),
  };
}

Deno.test("#3429 R1 turn sweep: status fails a running attempt silent for 421 s with one failed event and leaves 419 s and completed alone", async () => {
  const stale = new FakeDb();
  stale.tables.set("agent_turn_attempts", [attemptRow("running", 421)]);
  const result = await loadAriTurnStatus({
    userClient: stale.client(),
    admin: stale.client(),
    userId: USER,
    attempt: { ...attemptRow("running", 421) } as never,
    nowMs: NOW,
  });
  assert(result.ok);
  assertEquals(result.attempt.status, "failed");
  assertEquals(result.attempt.error_code, "EXECUTION_INTERRUPTED");
  const events = stale.tables.get("agent_activity_events") ?? [];
  assertEquals(events.map((event) => event.event_type), ["failed"]);

  for (const [status, secondsAgo] of [["running", 419], ["completed", 900]] as const) {
    const db = new FakeDb();
    db.tables.set("agent_turn_attempts", [attemptRow(status, secondsAgo)]);
    const swept = await sweepInterruptedAriTurnAttempt({
      admin: db.client(),
      userId: USER,
      attempt: { ...attemptRow(status, secondsAgo) } as never,
      nowMs: NOW,
    });
    assertEquals(swept, null);
    assertEquals(db.tables.get("agent_turn_attempts")![0].status, status);
    assertEquals(db.rpcCalls.length, 0);
  }
});
