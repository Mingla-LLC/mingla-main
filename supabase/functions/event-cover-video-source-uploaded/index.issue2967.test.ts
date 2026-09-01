// #2967 — the acknowledgement loop had no deadline and no exit.
//
// These tests drive the REAL acknowledgement loop: the same handler, called
// over and over against a stateful job row and a Bunny that never commits the
// object, exactly as the client's 2s loop did in production (120 calls in 346
// seconds, every one HTTP 200, every one a database no-op). A single mocked
// call cannot tell "returns pending once" from "returns pending forever", which
// IS the bug — so nothing here asserts on one response in isolation.
import {
  handleEventCoverVideoSourceUploaded,
  SOURCE_ACK_DEADLINE_MS,
} from "./index.ts";

const JOB_ID = "11a18413-bfbf-4087-9ba7-45f70deba0f3";
const USER_ID = "44a18413-bfbf-4087-9ba7-45f70deba0f3";
const BRAND_ID = "22a18413-bfbf-4087-9ba7-45f70deba0f3";
const SOURCE_BYTES = 1819005;
const GUID = "7df9b905-18be-4353-8355-e4e44cbd546b";

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

type JobRow = Record<string, unknown>;

const baseJob = (overrides: JobRow = {}): JobRow => ({
  id: JOB_ID,
  status: "source_uploading",
  target_kind: "venue_draft",
  event_id: null,
  brand_id: BRAND_ID,
  venue_id: null,
  draft_owner_key: "draft-a",
  requested_by: USER_ID,
  source_asset_id: GUID,
  source_bytes: SOURCE_BYTES,
  tus_resource_url: "https://tus/resource",
  provider_payload: {},
  tus_upload_length: SOURCE_BYTES,
  tus_upload_offset: 0,
  tus_expires_at: null,
  failure_code: null,
  ...overrides,
});

const request = (): Request =>
  new Request("https://test/source-uploaded", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jobId: JOB_ID,
      target: "venue_draft",
      brandId: BRAND_ID,
    }),
  });

// Stateful harness: the job row is mutated by updates and by the transition
// RPC, so a later acknowledgement observes what an earlier one wrote. Without
// that, the acknowledgement clock could never be read back and the deadline
// would be untestable.
const harness = (options: { storageSize: number; job?: JobRow }) => {
  let row: JobRow = baseJob(options.job ?? {});
  let storageSize = options.storageSize;
  let bunnyStatus = 1;
  const updates: JobRow[] = [];
  const transitions: Record<string, unknown>[] = [];
  let destroys = 0;

  // Faithful to the shipped `cover_video_transition_job` matrix: there is NO
  // source_uploading -> ready edge and there never was one here.
  const legalEdges: Record<string, string[]> = {
    source_uploading: ["source_uploaded", "failed", "cancelled", "superseded"],
    source_uploaded: [
      "processing_queued",
      "processing",
      "ready",
      "failed",
      "cancelled",
      "superseded",
    ],
  };

  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: row, error: null }),
        }),
      }),
      update: (patch: JobRow) => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: () => {
                updates.push(patch);
                row = { ...row, ...patch };
                return Promise.resolve({ data: row, error: null });
              },
            }),
          }),
        }),
      }),
    }),
    rpc: (name: string, args: Record<string, unknown>) => {
      transitions.push({ name, ...args });
      const from = String(row.status);
      const to = String(args.p_to_status);
      const fromList = args.p_from_statuses as string[];
      if (fromList.includes(from) && (legalEdges[from] ?? []).includes(to)) {
        row = { ...row, ...((args.p_patch ?? {}) as JobRow), status: to };
      }
      return Promise.resolve({ data: row, error: null });
    },
  };

  return {
    updates,
    transitions,
    get destroys() {
      return destroys;
    },
    get row() {
      return row;
    },
    commitObject: (bytes: number, status: number): void => {
      storageSize = bytes;
      bunnyStatus = status;
    },
    deps: {
      bunnyGetVideo: () =>
        Promise.resolve({
          ok: true as const,
          video: {
            guid: GUID,
            status: bunnyStatus,
            length: storageSize > 0 ? 15 : 0,
            storageSize,
            availableResolutions: storageSize > 0 ? "480p,240p,360p" : null,
            encodeProgress: 0,
            outputCodecs: null,
            originalHash: null,
          },
        }),
      bunnyPresignTusUpload: () =>
        Promise.resolve({
          authorizationSignature: "sig",
          authorizationExpire: 9999999999,
          libraryId: "lib",
          videoId: GUID,
          tusEndpoint: "https://tus",
        }),
      destroyCoverVideoAsset: () => {
        destroys += 1;
        return Promise.resolve({ ok: true as const });
      },
      requireUserId: () => Promise.resolve(USER_ID),
      requireCoverVideoTargetManager: () => Promise.resolve({ target: {} }),
      serviceRoleClient: () => client,
    },
  };
};

// Bunny's own HEAD reports the transfer as EXACTLY complete — the precondition
// for every branch under test. The bytes really are delivered; the object is
// simply never committed.
const withCompletedTusHead = async (run: () => Promise<void>): Promise<void> => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, {
        status: 200,
        headers: {
          "upload-offset": String(SOURCE_BYTES),
          "upload-length": String(SOURCE_BYTES),
        },
      }),
    )) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = realFetch;
  }
};

const withClock = async (
  startMs: number,
  run: (advance: (ms: number) => void) => Promise<void>,
): Promise<void> => {
  const realNow = Date.now;
  let current = startMs;
  Date.now = () => current;
  try {
    await run((ms) => {
      current += ms;
    });
  } finally {
    Date.now = realNow;
  }
};

Deno.test("#2967 the real acknowledgement loop is BOUNDED — an uncommitted Bunny object fails instead of spinning forever", async () => {
  const h = harness({ storageSize: 0 });
  const observed: string[] = [];
  await withCompletedTusHead(() =>
    withClock(Date.parse("2026-09-01T13:30:08.000Z"), async (advance) => {
      // The production cadence: one acknowledgement every ~2s, forever.
      for (let call = 0; call < 200; call += 1) {
        const response = await handleEventCoverVideoSourceUploaded(
          request(),
          h.deps as never,
        );
        const body = await response.json();
        observed.push(String(body.status));
        assert(
          response.status === 200,
          `acknowledgement ${call} returned ${response.status}`,
        );
        if (body.status !== "source_uploading") break;
        advance(2_000);
      }
    })
  );
  const last = observed[observed.length - 1];
  assert(
    last === "failed",
    `loop never left source_uploading — ${observed.length} acknowledgements, last status ${last}`,
  );
  assert(
    String(h.row.failure_code) === "source_ack_deadline_exceeded",
    `expected source_ack_deadline_exceeded, got ${h.row.failure_code}`,
  );
  // Bounded, and bounded by the DEADLINE rather than by the loop guard above.
  const maxCalls = Math.ceil(SOURCE_ACK_DEADLINE_MS / 2_000) + 3;
  assert(
    observed.length <= maxCalls,
    `deadline took ${observed.length} acknowledgements, expected <= ${maxCalls}`,
  );
  assert(
    h.destroys === 1,
    `expected the orphaned Bunny asset to be destroyed once, got ${h.destroys}`,
  );
});

Deno.test("#2967 the acknowledgement clock starts when the TUS offsets match and is read back on later calls", async () => {
  const h = harness({ storageSize: 0 });
  await withCompletedTusHead(() =>
    withClock(Date.parse("2026-09-01T13:30:08.000Z"), async (advance) => {
      const first = await handleEventCoverVideoSourceUploaded(
        request(),
        h.deps as never,
      );
      assert(
        (await first.json()).status === "source_uploading",
        "first pass must stay canonical source_uploading",
      );
      const ack =
        (h.row.provider_payload as Record<string, unknown>).source_ack as
          | Record<string, unknown>
          | undefined;
      assert(
        typeof ack?.tus_complete_at === "string",
        "the first pending acknowledgement did not record the clock — it was a database no-op",
      );
      assert(
        ack?.tus_offset === SOURCE_BYTES,
        "the recorded clock did not carry the proven-complete offset",
      );
      const started = ack?.tus_complete_at;

      advance(4_000);
      const second = await handleEventCoverVideoSourceUploaded(
        request(),
        h.deps as never,
      );
      assert(
        (await second.json()).status === "source_uploading",
        "a 4s-old clock must still be pending",
      );
      const ackAgain =
        (h.row.provider_payload as Record<string, unknown>).source_ack as
          | Record<string, unknown>
          | undefined;
      assert(
        ackAgain?.tus_complete_at === started,
        "the clock was restarted on a later call — the deadline would never arrive",
      );
      assert(
        String(h.row.status) === "source_uploading",
        "a young clock must not fail the job",
      );
    })
  );
});

Deno.test("#2967 a TUS resource that expired while still source_uploading is a DEFINITE death, failed immediately", async () => {
  const h = harness({
    storageSize: 0,
    job: { tus_expires_at: "2026-09-01T14:30:08.000Z" },
  });
  await withCompletedTusHead(() =>
    // One second past the production job's real expiry.
    withClock(Date.parse("2026-09-01T14:30:09.000Z"), async () => {
      const response = await handleEventCoverVideoSourceUploaded(
        request(),
        h.deps as never,
      );
      const body = await response.json();
      assert(body.status === "failed", `expired transport returned ${body.status}`);
      assert(
        String(h.row.failure_code) === "source_transport_expired",
        `expected source_transport_expired, got ${h.row.failure_code}`,
      );
      assert(h.destroys === 1, "the dead Bunny asset was not destroyed");
    })
  );
});

Deno.test("#2967 an expired TUS resource NEVER kills a job Bunny actually committed", async () => {
  const h = harness({
    storageSize: SOURCE_BYTES,
    job: { tus_expires_at: "2026-09-01T14:30:08.000Z" },
  });
  await withCompletedTusHead(() =>
    withClock(Date.parse("2026-09-01T15:00:00.000Z"), async () => {
      const response = await handleEventCoverVideoSourceUploaded(
        request(),
        h.deps as never,
      );
      const body = await response.json();
      assert(
        body.status === "source_uploaded",
        `a committed object with a stale transport returned ${body.status}`,
      );
      assert(h.destroys === 0, "a committed upload must never be destroyed");
    })
  );
});

Deno.test("#2967 a Bunny that commits inside the window still acknowledges normally", async () => {
  const h = harness({ storageSize: 0 });
  await withCompletedTusHead(() =>
    withClock(Date.parse("2026-09-01T13:30:08.000Z"), async (advance) => {
      await handleEventCoverVideoSourceUploaded(request(), h.deps as never);
      advance(20_000);
      // Bunny registers the object at +20s, well inside the 90s window.
      h.commitObject(SOURCE_BYTES, 3);
      const response = await handleEventCoverVideoSourceUploaded(
        request(),
        h.deps as never,
      );
      const body = await response.json();
      assert(
        body.status === "source_uploaded",
        `late-but-alive Bunny returned ${body.status}`,
      );
      assert(
        String(h.row.failure_code ?? "") === "",
        "a healthy job was given a failure code",
      );
    })
  );
});
