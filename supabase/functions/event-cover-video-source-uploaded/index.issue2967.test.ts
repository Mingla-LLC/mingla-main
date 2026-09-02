// #2967 — the acknowledgement loop had no deadline and no exit.
//
// These tests drive the REAL acknowledgement loop: the same handler, called
// over and over against a stateful job row and a Bunny that never commits the
// object, exactly as the client's 2s loop did in production (120 calls in 346
// seconds, every one HTTP 200, every one a database no-op). A single mocked
// call cannot tell "returns pending once" from "returns pending forever", which
// IS the bug — so nothing here asserts on one response in isolation.
// [TEST-MOD-APPROVED #3040] `SOURCE_ACK_DEADLINE_MS` no longer exists to import.
// It was the deadline on an ENCODE that was mistaken for a transfer, and its
// breach DESTROYED the provider asset (#3039). Acknowledgement is now gated on
// exact TUS offset equality, which is complete proof the bytes arrived, so
// there is no window to bound and nothing to destroy.
import { handleEventCoverVideoSourceUploaded } from "./index.ts";

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

// [TEST-MOD-APPROVED #3040] SUPERSEDED ASSERTION, named precisely.
//
// This test previously asserted that a Bunny which never commits the object
// drives the job to `failed` with `source_ack_deadline_exceeded` and that its
// asset is DESTROYED (`h.destroys === 1`). Both halves are invalidated.
//
// `storageSize` is a POST-ENCODE signal (#3039: job e055c562 reported
// storageSize = 14,808,154 together with bunny_status = 4 Finished at 21s), so
// "uncommitted object" never meant "the bytes are not there" — it meant "Bunny
// has not finished encoding yet". The deadline was therefore an encode deadline
// wired to a delete, and it destroyed videos Bunny was still working on.
//
// What replaces it is the STRONGER property: with the transfer proven complete
// by Bunny's own HEAD, the very first acknowledgement settles the job and no
// asset is ever destroyed by this endpoint. The production stream of 120
// acknowledgements is now structurally impossible.
Deno.test("#3040 an uncommitted Bunny object is acknowledged on the FIRST call and its asset is NEVER destroyed", async () => {
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
  assert(
    observed.length === 1,
    `the loop ran ${observed.length} times; exact TUS offset equality settles it on the first call`,
  );
  assert(
    observed[0] === "source_uploaded",
    `first acknowledgement returned ${observed[0]}, not source_uploaded`,
  );
  assert(
    h.row.failure_code === null,
    `a fully transferred source was failed with ${h.row.failure_code}`,
  );
  assert(
    h.row.tus_upload_offset === SOURCE_BYTES,
    "the proven offset was not persisted",
  );
  // THE #3039 REGRESSION. This is the assertion the whole umbrella exists for.
  assert(
    h.destroys === 0,
    `the endpoint destroyed a provider asset Bunny may still be encoding (${h.destroys} destroys)`,
  );
});

// [TEST-MOD-APPROVED #3040] TWO SUPERSEDED TESTS REPLACED BY ONE, named.
//
// (a) "#2967 the lag path writes AT MOST ONCE across the full 120-retry
//     production stream" and
// (b) "#2967 the acknowledgement clock starts when the TUS offsets match and is
//     read back on later calls"
//
// both pinned the shape of a LAG PATH — a branch that answers an unchanged
// canonical `source_uploading` while `storageSize` is zero, plus the
// `provider_payload.source_ack` clock that bounded it. #3040 deletes that
// branch outright: `storageSize` is a post-encode signal and was never
// evidence about the transfer, so there is nothing to lag on and no clock to
// keep. A 120-retry stream can no longer be produced at all.
//
// What (a) was really protecting — the acknowledgement must not fabricate a
// source offset, must not amplify writes, and must not destroy provider work —
// is pinned here in a strictly stronger form: EXACTLY ONE write, whose offset
// is the one Bunny's HEAD proved, and zero destroys.
Deno.test("#3040 acknowledgement is one write with the PROVEN offset, and never waits on encode state", async () => {
  // Every Bunny API status that can co-exist with a completed transfer and a
  // zero storageSize. Not one of them may hold the acknowledgement back.
  //   0 Created · 1 Uploaded · 2 Processing · 3 Transcoding
  for (const bunnyStatus of [0, 1, 2, 3]) {
    const h = harness({ storageSize: 0 });
    h.commitObject(0, bunnyStatus);
    await withCompletedTusHead(() =>
      withClock(Date.parse("2026-09-01T13:30:08.000Z"), async () => {
        const response = await handleEventCoverVideoSourceUploaded(
          request(),
          h.deps as never,
        );
        const body = await response.json();
        assert(
          body.status === "source_uploaded",
          `bunny api status ${bunnyStatus} + storageSize 0 returned ${body.status} — encode state gated the transfer`,
        );
      })
    );
    assert(
      h.updates.length === 1,
      `bunny api status ${bunnyStatus}: ${h.updates.length} writes, expected exactly 1`,
    );
    const [patch] = h.updates;
    assert(
      patch.tus_upload_offset === SOURCE_BYTES,
      "the acknowledgement did not persist the offset Bunny's own HEAD proved",
    );
    assert(
      patch.status === "source_uploaded",
      `the acknowledgement wrote status ${patch.status}`,
    );
    assert(
      h.destroys === 0,
      `bunny api status ${bunnyStatus}: provider work was destroyed`,
    );
    assert(
      h.transitions.length === 0,
      "a healthy acknowledgement used the failure transition RPC",
    );
    // No `source_ack` clock is written any more — there is no window to time.
    const payload = h.row.provider_payload as Record<string, unknown>;
    assert(
      payload.source_ack === undefined,
      "an acknowledgement clock was written for a deadline that no longer exists",
    );
  }
});

// [TEST-MOD-APPROVED #3040] TWO SUPERSEDED ASSERTIONS, named precisely.
//
// (1) This test drove an expired lease with a COMPLETED TUS HEAD and expected
//     `failed`. That is now wrong in the most dangerous direction available: a
//     completed transfer is proof the bytes are on Bunny, so an expired lease
//     is irrelevant and the job must be ACKNOWLEDGED, not killed. The expiry
//     branch now sits AFTER the transfer proof and can only fire on a transfer
//     that is genuinely incomplete — driven below with a partial HEAD.
// (2) `h.destroys === 1` is invalidated outright. This endpoint destroys
//     NOTHING, ever (#3040 invariant 1): it cannot see whether the provider is
//     mid-encode. `event-cover-video-reaper` is the single owner of asset
//     reclamation and re-reads provider truth before deleting.
Deno.test("#3040 an expired TUS lease fails ONLY an incomplete transfer, and destroys nothing", async () => {
  const h = harness({
    storageSize: 0,
    job: { tus_expires_at: "2026-09-01T14:30:08.000Z" },
  });
  const realFetch = globalThis.fetch;
  // A genuinely PARTIAL transfer: 512 of 1,819,005 bytes.
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, {
        status: 200,
        headers: {
          "upload-offset": "512",
          "upload-length": String(SOURCE_BYTES),
        },
      }),
    )) as typeof fetch;
  try {
    // One second past the production job's real expiry.
    await withClock(Date.parse("2026-09-01T14:30:09.000Z"), async () => {
      const response = await handleEventCoverVideoSourceUploaded(
        request(),
        h.deps as never,
      );
      const body = await response.json();
      assert(
        body.status === "failed",
        `expired transport with an incomplete transfer returned ${body.status}`,
      );
      assert(
        String(h.row.failure_code) === "source_transport_expired",
        `expected source_transport_expired, got ${h.row.failure_code}`,
      );
      assert(
        h.destroys === 0,
        "the acknowledgement endpoint destroyed a provider asset",
      );
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

// The #3039 regression in its exact production shape: the transfer completed,
// Bunny is still encoding so `storageSize` is 0, and the one-hour TUS lease has
// since expired because the user was away. Under the shipped code this job was
// failed AND its asset deleted. It must now be acknowledged.
Deno.test("#3040 an expired TUS lease NEVER kills a completed transfer, even with storageSize still zero", async () => {
  const h = harness({
    storageSize: 0,
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
        `a completed transfer with a stale lease returned ${body.status}`,
      );
      assert(h.destroys === 0, "a completed upload must never be destroyed");
      assert(
        h.row.failure_code === null,
        `a completed transfer was failed with ${h.row.failure_code}`,
      );
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
