// Issue #3429 REWORK-2 implementor proof — R-1.
//
// An attachment you prepare and then never send sits in `ready` with a NULL
// `client_turn_id`. Before this fix the hourly cleanup worker reclaimed every
// abandoned state EXCEPT that one, so such a row outlived its 24-hour
// `expires_at` forever: its two private storage objects were never queued for
// deletion, and `finalizeAriAttachment`'s duplicate check — scoped to exactly
// `state = 'ready' AND client_turn_id IS NULL` — refused that same file for
// that user and brand permanently with DUPLICATE_FILE.
//
// These assertions execute the real shipped `reclaimExpiredAriAttachments` and
// the real shipped `finalizeAriAttachment` against a fake PostgREST that
// applies the query's own filters, so the proof is behavioural: the expired
// unbound `ready` row is deleted, the rows that must survive survive, its
// storage paths are queued by the delete trigger's fake, and the same bytes
// then reach `ready` again instead of DUPLICATE_FILE.

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  ARI_ATTACHMENT_RECLAIMED_STATES,
  finalizeAriAttachment,
  reclaimExpiredAriAttachments,
} from "../agentAttachmentFinalize.ts";

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

const encoder = new TextEncoder();

function comparable(value: unknown): number | string {
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : parsed;
  }
  return value as number;
}

/** A PostgREST builder that really applies `in` / `lt` / `eq` / `is` / `neq`. */
class FakeQuery implements PromiseLike<{ data: unknown; error: unknown }> {
  private filters: Filter[] = [];
  private mode: "select" | "update" | "delete" = "select";
  private patch: Row = {};
  private single = false;
  private limitCount: number | null = null;

  constructor(private readonly db: FakeDb, private readonly table: string) {}

  select(_columns?: string): this {
    return this;
  }
  update(patch: Row): this {
    this.mode = "update";
    this.patch = patch;
    return this;
  }
  delete(): this {
    this.mode = "delete";
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
    let matched = rows.filter((row) => this.filters.every((f) => f(row)));
    if (this.limitCount !== null) matched = matched.slice(0, this.limitCount);
    if (this.mode === "delete") {
      for (const row of matched) {
        // The migration's delete trigger queues both opaque paths BEFORE the
        // row disappears; this fake stands in for that trigger.
        this.db.queuedPaths.push(row.storage_path as string);
        if (row.derived_storage_path) {
          this.db.queuedPaths.push(row.derived_storage_path as string);
        }
        rows.splice(rows.indexOf(row), 1);
      }
      return { data: null, error: null };
    }
    if (this.mode === "update") {
      for (const row of matched) Object.assign(row, this.patch);
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
  objects = new Map<string, Uint8Array>();
  queuedPaths: string[] = [];

  client(): never {
    const db = this;
    return {
      from: (table: string) => new FakeQuery(db, table),
      rpc: () => Promise.resolve({ data: null, error: null }),
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
          upload: (path: string, bytes: Uint8Array) => {
            db.objects.set(path, bytes);
            return Promise.resolve({ data: null, error: null });
          },
          remove: (paths: string[]) => {
            for (const path of paths) db.objects.delete(path);
            return Promise.resolve({ data: null, error: null });
          },
        }),
      },
    } as never;
  }
}

const USER = "11111111-1111-4111-8111-111111111111";
const BRAND = "22222222-2222-4222-8222-222222222222";
const ORPHAN = "33333333-3333-4333-8333-333333333333";
const FRESH = "44444444-4444-4444-8444-444444444444";
const SENT = "55555555-5555-4555-8555-555555555555";
const STALE_PREPARED = "66666666-6666-4666-8666-666666666666";
const RETRY = "77777777-7777-4777-8777-777777777777";
const NOW = Date.parse("2026-09-20T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60_000;

// sha256("leak probe") — the digest the orphan holds and the retry must reuse.
const PROBE_BYTES = encoder.encode("leak probe");

function row(id: string, overrides: Row = {}): Row {
  return {
    id,
    user_id: USER,
    brand_id: BRAND,
    conversation_id: null,
    message_id: null,
    client_turn_id: null,
    storage_path: `${USER}/${BRAND}/${id}/source`,
    derived_storage_path: null,
    original_filename: "leak-probe.txt",
    declared_mime: "text/plain",
    declared_size_bytes: PROBE_BYTES.byteLength,
    state: "prepared",
    failure_code: null,
    verified_mime: null,
    verified_size_bytes: null,
    file_type: "text",
    sha256: null,
    processing_token: null,
    processing_started_at: null,
    processing_attempts: 0,
    expires_at: new Date(NOW + DAY_MS).toISOString(),
    ...overrides,
  };
}

async function digestHex(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes.slice().buffer),
  );
  return Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
}

function seed(db: FakeDb, rows: Row[]): void {
  db.tables.set("agent_attachments", rows);
  for (const r of rows) {
    db.objects.set(r.storage_path as string, PROBE_BYTES.slice());
    if (r.derived_storage_path) {
      db.objects.set(r.derived_storage_path as string, PROBE_BYTES.slice());
    }
  }
}

Deno.test("#3429 R2 R-1: an expired unbound `ready` row is reclaimed with both its objects, and the rows that must survive do", async () => {
  const sha = await digestHex(PROBE_BYTES);
  const db = new FakeDb();
  const expired = new Date(NOW - 2 * DAY_MS).toISOString();
  seed(db, [
    // The orphan: prepared, never sent, two days past its 24-hour expiry.
    row(ORPHAN, {
      state: "ready",
      sha256: sha,
      verified_mime: "text/plain",
      verified_size_bytes: PROBE_BYTES.byteLength,
      derived_storage_path: `${USER}/${BRAND}/${ORPHAN}/derived`,
      expires_at: expired,
    }),
    // Still inside its 24-hour window — the tray the user is filling right now.
    row(FRESH, { state: "ready", sha256: sha }),
    // Sent: binding rewrote `expires_at` to 30 days, so this is NOT expired.
    row(SENT, {
      state: "ready",
      sha256: sha,
      conversation_id: "88888888-8888-4888-8888-888888888888",
      message_id: "99999999-9999-4999-8999-999999999999",
      client_turn_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      expires_at: new Date(NOW + 29 * DAY_MS).toISOString(),
    }),
    // The state that was already reclaimed before this fix — still reclaimed.
    row(STALE_PREPARED, { expires_at: expired }),
  ]);

  await reclaimExpiredAriAttachments({ admin: db.client(), nowMs: NOW });

  const remaining = (db.tables.get("agent_attachments") ?? []).map((r) => r.id);
  assert(
    !remaining.includes(ORPHAN),
    `the expired unbound ready row survived the worker: ${
      JSON.stringify(remaining)
    }`,
  );
  assert(!remaining.includes(STALE_PREPARED), "expired prepared row survived");
  assertEquals(remaining.sort(), [FRESH, SENT].sort());
  // The delete trigger queued BOTH opaque paths for the orphan, and nothing
  // for the rows that stayed.
  assertEquals(db.queuedPaths.sort(), [
    `${USER}/${BRAND}/${ORPHAN}/source`,
    `${USER}/${BRAND}/${ORPHAN}/derived`,
    `${USER}/${BRAND}/${STALE_PREPARED}/source`,
  ].sort());
});

Deno.test("#3429 R2 R-1: reclaiming the orphan frees its digest, so the same file attaches again", async () => {
  const sha = await digestHex(PROBE_BYTES);
  const expired = new Date(NOW - 2 * DAY_MS).toISOString();
  const orphan = () =>
    row(ORPHAN, {
      state: "ready",
      sha256: sha,
      verified_mime: "text/plain",
      verified_size_bytes: PROBE_BYTES.byteLength,
      expires_at: expired,
    });
  const retry = () => row(RETRY, { state: "prepared" });

  // Control: with the orphan still present, the same bytes are refused.
  const blocked = new FakeDb();
  seed(blocked, [orphan(), retry()]);
  const refusal = await finalizeAriAttachment(
    { admin: blocked.client(), userId: USER, now: () => NOW },
    RETRY,
  );
  assertEquals(refusal.state, "failed");
  assert(refusal.state === "failed");
  assertEquals(refusal.code, "DUPLICATE_FILE");

  // After the worker runs, the digest is free and the file reaches Ready.
  const swept = new FakeDb();
  seed(swept, [orphan(), retry()]);
  await reclaimExpiredAriAttachments({ admin: swept.client(), nowMs: NOW });
  const ready = await finalizeAriAttachment(
    { admin: swept.client(), userId: USER, now: () => NOW },
    RETRY,
  );
  assertEquals(ready.state, "ready");
  assert(ready.state === "ready");
  assertEquals(ready.attachment_id, RETRY);
});

Deno.test("#3429 R2 R-1: the reclaimed state list covers every non-terminal attachment state", () => {
  // The CHECK constraint on agent_attachments.state. Every one of them can be
  // abandoned, so every one of them must be reclaimable.
  assertEquals([...ARI_ATTACHMENT_RECLAIMED_STATES].sort(), [
    "discarded",
    "failed",
    "prepared",
    "processing",
    "ready",
    "uploaded",
  ]);
});
