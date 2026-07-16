/**
 * ISSUE-866 WP3 REWORK — QA-FAIL regression suite (APPEND-ONLY; new file — the
 * tester's issue866_wp3_tester_adversarial.test.ts is untouched per dispatch).
 *
 * QA report: Mingla_Artifacts/reports/QA_ISSUE-866_WP3.md (commit 3afeb451d).
 *
 *   F-1 (P1): two concurrent resolveCreativeRef calls produced uploads=2 with
 *   two DIFFERENT external_refs (one orphaned; on Google a stranded immutable
 *   asset). Fix under test: tryAcquireRefLock — an ATOMIC, CHECKED acquisition;
 *   losers route into the waiter and return the winner's ref.
 *   → T-RW1 uses CONTROLLED INTERLEAVING on the DB seam (both initial getRefs
 *     complete before either acquisition) and asserts AT-MOST-ONCE upload AND
 *     same-ref-for-both-callers. FAILS-ON-REVERT ANCHOR: deleting the checked-
 *     acquisition branch in resolveCreativeRef (falling back to the unchecked
 *     upsert) makes T-RW1 fail with uploads=2.
 *
 *   F-2 (P2): a crashed lock-holder left status='uploading' forever. Fix under
 *   test: the stale-takeover arm — updated_at older than
 *   STALE_LOCK_TAKEOVER_MS (15 min; sized on the chunked-Snap worst case plus
 *   the ~400 s edge wall-clock cap, documented on the constant) is acquirable.
 *
 *   F-3 (P3): a moov-less/truncated MP4 probed hasAudio=false (certainty
 *   fabricated from absence). Fix under test: hasAudio=null when no trak was
 *   parsed — AND null still hard-blocks audio-required channels at resolve
 *   time (failSafe not_evaluable), preserving the fail-safe direction.
 *
 * Run: deno test --allow-env --allow-read --no-check \
 *   supabase/functions/_shared/__tests__/issue866_wp3_rework.test.ts
 */

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import type { AdConnectionRow, Lane, Platform } from "../adChannel.ts";
import {
  type AcquireRefLockRow,
  type AdCreativeRow,
  type CreativeRefDb,
  CreativeRefLockedError,
  type CreativeRefRow,
  type CreativeUploadAdapter,
  type CreativeUploadedRef,
  CreativeValidationError,
  createSupabaseCreativeRefDb,
  CREATIVE_UPLOAD_ADAPTERS,
  resolveCreativeRef,
  STALE_LOCK_TAKEOVER_MS,
  type SupabaseLike,
} from "../adCreative.ts";
import { probeCreativeBytes } from "../adCreativeProbe.ts";
import { validateCreativeForChannel } from "../adCreativeMatrix.ts";
import { makeMp4 } from "./adCreativeProbe.test.ts";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const YIELD_SLEEP = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

function connection(platform: Platform): AdConnectionRow {
  return {
    id: "00000000-0000-0000-0000-00000000c0de",
    platform,
    lane: "consumer",
    display_name: `${platform} · Consumer`,
    external_account_id: "acct-rw",
    external_org_id: null,
    auth_kind: "system_user_token",
    token_env_var: "META_SYSTEM_USER_TOKEN",
    extra: {},
    status: "connected",
    currency: "USD",
    timezone: null,
    min_daily_budget_cents: 100,
    account_status: "ACTIVE",
    token_last_verified_at: null,
    connected: true,
  };
}

function imageCreative(overrides: Partial<AdCreativeRow> = {}): AdCreativeRow {
  return {
    id: "00000000-0000-0000-0000-00000000ee01",
    kind: "image",
    name: "rework-image",
    source_url: "https://cdn.example.com/rework.jpg",
    storage_bucket: "meta-ad-creatives",
    storage_path: "creatives/rework.jpg",
    bunny_video_id: null,
    poster_url: null,
    mp4_master_url: null,
    place_id: null,
    brand_id: null,
    width: 1440,
    height: 1800,
    aspect_ratio: 0.8,
    duration_seconds: null,
    mime_type: "image/jpeg",
    byte_size: 2 * 1024 * 1024,
    has_audio: null,
    content_hash: "hash-rework",
    ai_generated: true,
    variants: {},
    status: "active",
    ...overrides,
  };
}

/**
 * The atomic in-memory DB: tryAcquireRefLock performs its check-and-set in a
 * single synchronous step (no awaits inside), so it is truly atomic under
 * JS concurrency — exactly one concurrent caller can win, mirroring the
 * Postgres guarded-UPDATE semantics of createSupabaseCreativeRefDb.
 */
class AtomicRefDb implements CreativeRefDb {
  row: CreativeRefRow | null = null;
  connectionRow: AdConnectionRow;
  creativeRow: AdCreativeRow;
  acquireAttempts = 0;
  acquireWins = 0;
  legacyUpserts = 0;
  /** Controlled interleaving: the first N getRef calls all complete their read BEFORE any returns. */
  private barrierSize: number;
  private barrierWaiters: (() => void)[] = [];
  private barrierReads = 0;

  constructor(connectionRow: AdConnectionRow, creativeRow: AdCreativeRow, barrierSize = 0) {
    this.connectionRow = connectionRow;
    this.creativeRow = creativeRow;
    this.barrierSize = barrierSize;
  }

  // deno-lint-ignore require-await
  async getConnection(): Promise<AdConnectionRow | null> {
    return this.connectionRow;
  }
  // deno-lint-ignore require-await
  async getCreative(): Promise<AdCreativeRow | null> {
    return this.creativeRow;
  }
  async getRef(): Promise<CreativeRefRow | null> {
    if (this.barrierReads < this.barrierSize) {
      this.barrierReads++;
      const snapshot = this.row ? { ...this.row } : null; // read BEFORE the barrier releases
      await new Promise<void>((resolve) => {
        this.barrierWaiters.push(resolve);
        if (this.barrierWaiters.length === this.barrierSize) {
          for (const release of this.barrierWaiters) release();
        }
      });
      return snapshot;
    }
    return this.row ? { ...this.row } : null;
  }
  // deno-lint-ignore require-await
  async tryAcquireRefLock(row: AcquireRefLockRow, staleBefore: string): Promise<boolean> {
    this.acquireAttempts++;
    // Single synchronous check-and-set — atomic in the JS event loop.
    const existing = this.row;
    const acquirable = existing === null ||
      existing.status === "pending" || existing.status === "failed" ||
      (existing.status === "uploading" &&
        typeof existing.updated_at === "string" &&
        Date.parse(existing.updated_at) < Date.parse(staleBefore)) ||
      (existing.status === "ready" && existing.content_hash !== row.content_hash);
    if (!acquirable) return false;
    this.row = {
      id: existing?.id ?? "00000000-0000-0000-0000-00000000rrrw",
      creative_id: row.creative_id,
      platform: row.platform,
      lane: row.lane,
      external_account_id: row.external_account_id,
      external_kind: row.external_kind,
      external_ref: existing?.external_ref ?? null,
      external_ref_extra: existing?.external_ref_extra ?? {},
      content_hash: row.content_hash,
      status: "uploading",
      error: null,
      uploaded_at: existing?.uploaded_at ?? null,
      updated_at: new Date().toISOString(),
    };
    this.acquireWins++;
    return true;
  }
  // deno-lint-ignore require-await
  async upsertRefUploading(): Promise<void> {
    this.legacyUpserts++;
  }
  // deno-lint-ignore require-await
  async markRefReady(
    _c: string,
    _p: Platform,
    _l: Lane,
    _a: string,
    ref: CreativeUploadedRef,
    contentHash: string,
  ): Promise<void> {
    if (!this.row) return;
    this.row = {
      ...this.row,
      status: "ready",
      external_ref: ref.external_ref,
      external_ref_extra: ref.external_ref_extra,
      external_kind: ref.external_kind,
      content_hash: contentHash,
      uploaded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }
  // deno-lint-ignore require-await
  async markRefFailed(_c: string, _p: Platform, _l: Lane, _a: string, error: string): Promise<void> {
    if (!this.row) return;
    this.row = { ...this.row, status: "failed", error, updated_at: new Date().toISOString() };
  }
}

function slowCountingAdapter(platform: Platform): { adapter: CreativeUploadAdapter; calls: () => number } {
  let count = 0;
  return {
    adapter: {
      platform,
      upload: async (): Promise<CreativeUploadedRef> => {
        count++;
        const mine = count;
        // Hold the lock across several macrotasks so the loser demonstrably waits.
        await new Promise((r) => setTimeout(r, 5));
        return {
          external_kind: "image",
          external_ref: `winner-ref-${mine}`,
          external_ref_extra: {},
          external_account_id: "acct-rw",
        };
      },
    },
    calls: () => count,
  };
}

function withAdapter(platform: Platform, adapter: CreativeUploadAdapter): Record<Platform, CreativeUploadAdapter> {
  return { ...CREATIVE_UPLOAD_ADAPTERS, [platform]: adapter };
}

// ── F-1: at-most-once upload under a TRUE race (controlled interleaving) ──────

Deno.test("T-RW1 (F-1): two concurrent resolves, both initial reads pre-acquisition → EXACTLY ONE upload, BOTH callers get the SAME external_ref", async () => {
  // FAILS-ON-REVERT ANCHOR: deleting the checked-acquisition branch in
  // resolveCreativeRef (reverting to the unchecked upsert-and-assume-won) makes
  // this test fail with uploads=2 and divergent refs — the exact QA T5 defect.
  const { adapter, calls } = slowCountingAdapter("meta");
  const db = new AtomicRefDb(connection("meta"), imageCreative(), 2); // barrier: BOTH getRefs read null first
  const opts = { adapters: withAdapter("meta", adapter), sleep: YIELD_SLEEP };

  const [a, b] = await Promise.all([
    resolveCreativeRef(db, db.creativeRow.id, "meta", "consumer", opts),
    resolveCreativeRef(db, db.creativeRow.id, "meta", "consumer", opts),
  ]);

  assertEquals(calls(), 1, "AT-MOST-ONCE: the platform saw exactly one upload");
  assertEquals(a.external_ref, "winner-ref-1");
  assertEquals(b.external_ref, "winner-ref-1"); // the loser received the WINNER's ref
  assertEquals(db.acquireWins, 1, "exactly one caller won the lock");
  assert(db.acquireAttempts >= 2, "both callers attempted acquisition");
  assertEquals(db.legacyUpserts, 0, "the unchecked legacy path never ran");
  assertEquals(db.row?.status, "ready");
  assertEquals(db.row?.external_ref, "winner-ref-1");
});

Deno.test("T-RW2 (F-1): three-way race — still one upload, all three callers converge on the same ref", async () => {
  const { adapter, calls } = slowCountingAdapter("meta");
  const db = new AtomicRefDb(connection("meta"), imageCreative(), 3);
  const opts = { adapters: withAdapter("meta", adapter), sleep: YIELD_SLEEP };
  const results = await Promise.all([
    resolveCreativeRef(db, db.creativeRow.id, "meta", "consumer", opts),
    resolveCreativeRef(db, db.creativeRow.id, "meta", "consumer", opts),
    resolveCreativeRef(db, db.creativeRow.id, "meta", "consumer", opts),
  ]);
  assertEquals(calls(), 1);
  for (const result of results) assertEquals(result.external_ref, "winner-ref-1");
});

Deno.test("T-RW3 (F-1): racing a hash-mismatch takeover — one fresh upload, both callers get the NEW ref", async () => {
  const { adapter, calls } = slowCountingAdapter("meta");
  const db = new AtomicRefDb(connection("meta"), imageCreative({ content_hash: "hash-NEW" }), 2);
  db.row = {
    id: "00000000-0000-0000-0000-00000000rrrw",
    creative_id: db.creativeRow.id,
    platform: "meta",
    lane: "consumer",
    external_account_id: "acct-rw",
    external_kind: "image",
    external_ref: "stale-bytes-ref",
    external_ref_extra: {},
    content_hash: "hash-STALE",
    status: "ready",
    error: null,
    uploaded_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  };
  const opts = { adapters: withAdapter("meta", adapter), sleep: YIELD_SLEEP };
  const [a, b] = await Promise.all([
    resolveCreativeRef(db, db.creativeRow.id, "meta", "consumer", opts),
    resolveCreativeRef(db, db.creativeRow.id, "meta", "consumer", opts),
  ]);
  assertEquals(calls(), 1, "the stale-bytes takeover also uploads at most once");
  assertEquals(a.external_ref, "winner-ref-1");
  assertEquals(b.external_ref, "winner-ref-1");
  assertEquals(db.row?.content_hash, "hash-NEW");
});

// ── F-2: stale-lock takeover ──────────────────────────────────────────────────

Deno.test("T-RW4 (F-2): a STALE 'uploading' lock (crashed holder) is taken over and completes", async () => {
  const { adapter, calls } = slowCountingAdapter("meta");
  const db = new AtomicRefDb(connection("meta"), imageCreative());
  const staleTime = new Date(Date.now() - STALE_LOCK_TAKEOVER_MS - 60_000).toISOString();
  db.row = {
    id: "00000000-0000-0000-0000-00000000rrrw",
    creative_id: db.creativeRow.id,
    platform: "meta",
    lane: "consumer",
    external_account_id: "acct-rw",
    external_kind: "image",
    external_ref: null,
    external_ref_extra: {},
    content_hash: "hash-rework",
    status: "uploading", // parked forever by a crashed edge fn — QA T7
    error: null,
    uploaded_at: null,
    updated_at: staleTime,
  };
  const result = await resolveCreativeRef(db, db.creativeRow.id, "meta", "consumer", {
    adapters: withAdapter("meta", adapter),
    sleep: YIELD_SLEEP,
  });
  assertEquals(calls(), 1, "the takeover re-ran the upload");
  assertEquals(result.external_ref, "winner-ref-1");
  assertEquals(db.row?.status, "ready", "the creative is no longer bricked");
});

Deno.test("T-RW5 (F-2 guard): a FRESH 'uploading' lock is NOT taken over — waiter then retryable throw", async () => {
  const { adapter, calls } = slowCountingAdapter("meta");
  const db = new AtomicRefDb(connection("meta"), imageCreative());
  db.row = {
    id: "00000000-0000-0000-0000-00000000rrrw",
    creative_id: db.creativeRow.id,
    platform: "meta",
    lane: "consumer",
    external_account_id: "acct-rw",
    external_kind: "image",
    external_ref: null,
    external_ref_extra: {},
    content_hash: "hash-rework",
    status: "uploading",
    error: null,
    uploaded_at: null,
    updated_at: new Date().toISOString(), // fresh — a live holder
  };
  await assertRejects(
    () =>
      resolveCreativeRef(db, db.creativeRow.id, "meta", "consumer", {
        adapters: withAdapter("meta", adapter),
        sleep: () => Promise.resolve(),
      }),
    CreativeRefLockedError,
  );
  assertEquals(calls(), 0, "a live holder's lock is never stolen");
  assertEquals(db.acquireWins, 0);
});

Deno.test("T-RW6 (F-2): STALE_LOCK_TAKEOVER_MS is 15 minutes (sized on the chunked-Snap worst case + edge wall-clock cap)", () => {
  assertEquals(STALE_LOCK_TAKEOVER_MS, 15 * 60_000);
});

// ── The supabase-backed acquisition: conditional shape + win/lose semantics ───

interface ScriptedCall {
  kind: "upsert" | "update" | "select";
  values?: Record<string, unknown>;
  opts?: Record<string, unknown>;
  eqs: [string, unknown][];
  or?: string;
}

function scriptedClient(script: { upsertRows: unknown[]; updateRows: unknown[] }): {
  client: SupabaseLike;
  calls: ScriptedCall[];
} {
  const calls: ScriptedCall[] = [];
  interface BuilderLike extends PromiseLike<{ data: Record<string, unknown>[]; error: { message: string } | null }> {
    eq(column: string, value: unknown): BuilderLike;
    or(filters: string): BuilderLike;
    select(columns: string): BuilderLike;
    maybeSingle(): Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
  }
  const makeBuilder = (call: ScriptedCall, rows: unknown[]): BuilderLike => {
    const result: { data: Record<string, unknown>[]; error: { message: string } | null } = {
      data: rows as Record<string, unknown>[],
      error: null,
    };
    const promise = Promise.resolve(result);
    const builder: BuilderLike = {
      eq(column: string, value: unknown): BuilderLike {
        call.eqs.push([column, value]);
        return builder;
      },
      or(filters: string): BuilderLike {
        call.or = filters;
        return builder;
      },
      select(_columns: string): BuilderLike {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve({ data: (rows[0] ?? null) as Record<string, unknown> | null, error: null });
      },
      then: promise.then.bind(promise),
    };
    return builder;
  };
  const client: SupabaseLike = {
    from(_table: string) {
      return {
        select(_columns: string) {
          const call: ScriptedCall = { kind: "select", eqs: [] };
          calls.push(call);
          return makeBuilder(call, []);
        },
        upsert(values: Record<string, unknown>, opts?: Record<string, unknown>) {
          const call: ScriptedCall = { kind: "upsert", values, opts, eqs: [] };
          calls.push(call);
          return makeBuilder(call, script.upsertRows);
        },
        update(values: Record<string, unknown>) {
          const call: ScriptedCall = { kind: "update", values, eqs: [] };
          calls.push(call);
          return makeBuilder(call, script.updateRows);
        },
      };
    },
  };
  return { client, calls };
}

const LOCK_ROW: AcquireRefLockRow = {
  creative_id: "c-1",
  platform: "meta",
  lane: "consumer",
  external_account_id: "acct-rw",
  external_kind: "image",
  content_hash: "hash-rework",
};

Deno.test("T-RW7: supabase acquisition — INSERT-with-ignoreDuplicates returning a row ⇒ WON, no update issued", async () => {
  const { client, calls } = scriptedClient({ upsertRows: [{ id: "r1" }], updateRows: [] });
  const db = createSupabaseCreativeRefDb(client);
  assert(db.tryAcquireRefLock, "the real impl MUST provide the atomic acquisition");
  const won = await db.tryAcquireRefLock!(LOCK_ROW, new Date().toISOString());
  assertEquals(won, true);
  const upsert = calls.find((c) => c.kind === "upsert");
  assert(upsert);
  assertEquals(upsert.opts?.ignoreDuplicates, true, "ON CONFLICT DO NOTHING — never clobber a holder");
  assertEquals(upsert.opts?.onConflict, "creative_id,platform,lane,external_account_id");
  assertEquals(upsert.values?.status, "uploading");
  assert(!calls.some((c) => c.kind === "update"), "insert won — the guarded update never ran");
});

Deno.test("T-RW8: supabase acquisition — insert conflict + guarded UPDATE returning a row ⇒ WON; predicate carries all three acquirable arms", async () => {
  const { client, calls } = scriptedClient({ upsertRows: [], updateRows: [{ id: "r1" }] });
  const db = createSupabaseCreativeRefDb(client);
  const staleBefore = "2026-07-15T00:00:00.000Z";
  const won = await db.tryAcquireRefLock!(LOCK_ROW, staleBefore);
  assertEquals(won, true);
  const update = calls.find((c) => c.kind === "update");
  assert(update);
  assertEquals(update.values?.status, "uploading");
  assertEquals(update.eqs.length, 4, "keyed on the full UNIQUE idempotency key");
  assert(update.or, "the guarded predicate exists");
  assertStringIncludes(update.or!, "status.in.(pending,failed)");
  assertStringIncludes(update.or!, `and(status.eq.uploading,updated_at.lt."${staleBefore}")`);
  assertStringIncludes(update.or!, "and(status.eq.ready,content_hash.neq.hash-rework)");
});

Deno.test("T-RW9: supabase acquisition — insert conflict + guarded UPDATE returning ZERO rows ⇒ LOST (waiter path)", async () => {
  const { client } = scriptedClient({ upsertRows: [], updateRows: [] });
  const db = createSupabaseCreativeRefDb(client);
  const won = await db.tryAcquireRefLock!(LOCK_ROW, new Date().toISOString());
  assertEquals(won, false, "another resolver holds the lock — this caller must NOT upload");
});

// ── F-3: honest hasAudio + preserved fail-safe direction ──────────────────────

Deno.test("T-RW10 (F-3): a moov-less MP4 probes hasAudio=null — unknown, not a fabricated false", async () => {
  const full = makeMp4({ durationSeconds: 30, width: 1080, height: 1920, withAudio: true });
  const ftypOnly = full.subarray(0, 24); // truncated before moov
  const probe = await probeCreativeBytes(ftypOnly);
  assertEquals(probe.kind, "video");
  assertEquals(probe.hasAudio, null, "no trak parsed ⇒ audio presence is UNKNOWN");
});

Deno.test("T-RW10b (F-3): a parsed silent MP4 still probes hasAudio=false (the positive claim stands)", async () => {
  const silent = makeMp4({ durationSeconds: 15, width: 1080, height: 1920, withAudio: false });
  const probe = await probeCreativeBytes(silent);
  assertEquals(probe.hasAudio, false);
});

Deno.test("T-RW11 (F-3): hasAudio=null carries failSafe on the audio-required not_evaluable (TikTok + Snap)", () => {
  for (const platform of ["tiktok", "snapchat"] as const) {
    const result = validateCreativeForChannel(platform, {
      kind: "video",
      mimeType: "video/mp4",
      container: "mp4/isom",
      width: 1080,
      height: 1920,
      aspectRatio: 0.5625,
      durationSeconds: 30,
      hasAudio: null,
      byteSize: 10 * 1024 * 1024,
      overallBitrateKbps: 2500,
      posterPresent: true,
      variantRatios: [],
    });
    const check = result.checks.find((c) => c.rule === "video.audio_required");
    assert(check, `${platform} audio check exists`);
    assertEquals(check.level, "not_evaluable");
    assertEquals(check.failSafe, true, `${platform}: unknown audio must block at resolve time`);
  }
});

Deno.test("T-RW12 (F-3 fail-safe): the resolver BLOCKS a hasAudio=null video for TikTok — unknown never softens into a pass", async () => {
  const { adapter, calls } = slowCountingAdapter("tiktok");
  const db = new AtomicRefDb(
    connection("tiktok"),
    imageCreative({
      kind: "video",
      bunny_video_id: "b-rw",
      poster_url: "https://cdn.example.com/p.jpg",
      mp4_master_url: "https://cdn.example.com/rw.mp4",
      duration_seconds: 30,
      mime_type: "video/mp4",
      has_audio: null, // truncated-probe creative
      aspect_ratio: 0.5625,
      width: 1080,
      height: 1920,
    }),
  );
  await assertRejects(
    () =>
      resolveCreativeRef(db, db.creativeRow.id, "tiktok", "consumer", {
        adapters: withAdapter("tiktok", adapter),
        sleep: () => Promise.resolve(),
      }),
    CreativeValidationError,
    "Audio-track presence could not be derived",
  );
  assertEquals(calls(), 0, "fail-safe: blocked BEFORE any platform call");
  assertEquals(db.acquireAttempts, 0, "blocked before lock acquisition");
});

Deno.test("T-RW13 (F-3 boundary): hasAudio=true video for TikTok still resolves (the fail-safe does not overblock)", async () => {
  const { adapter, calls } = slowCountingAdapter("tiktok");
  const db = new AtomicRefDb(
    connection("tiktok"),
    imageCreative({
      kind: "video",
      bunny_video_id: "b-rw",
      poster_url: "https://cdn.example.com/p.jpg",
      mp4_master_url: "https://cdn.example.com/rw.mp4",
      duration_seconds: 30,
      mime_type: "video/mp4",
      has_audio: true,
      aspect_ratio: 0.5625,
      width: 1080,
      height: 1920,
      byte_size: 10 * 1024 * 1024,
    }),
  );
  const result = await resolveCreativeRef(db, db.creativeRow.id, "tiktok", "consumer", {
    adapters: withAdapter("tiktok", adapter),
    sleep: YIELD_SLEEP,
  });
  assertEquals(calls(), 1);
  assertEquals(result.external_ref, "winner-ref-1");
});
