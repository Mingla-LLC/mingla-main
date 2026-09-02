// issue #3040 — INVARIANT 7: an abandoned job (client never returns) still
// reaches a terminal state SERVER-SIDE.
//
// Before this, it could not. `cover_video_claim_reconcile_jobs` claims a
// `source_uploading` row ONLY when `provider_allocation_uncertain_at IS NOT
// NULL`, so an ordinary abandoned upload — bytes on Bunny, client gone — was
// claimed by nothing at all. The production row sat 24h+ in `source_uploading`
// with `failure_code = NULL` and no affordance anywhere in the product.
//
// FAILS ON REVERT: delete the "#3040 ABANDONED source_uploading SWEEP" loop in
// `handleReaper` and both tests below fail — the recovered job never leaves
// `source_uploading`, and the dead-transport job never gets a `failure_code`.
//
// The sweep is driven through the REAL `handleReaper` against a faithful
// `cover_video_transition_job` CAS, not a mock of the sweep itself.
import { handleReaper } from "../index.ts";

const SERVICE_ROLE_KEY = "service-role-key-3040";
const JOB_ID = "3040aaaa-bbbb-4ccc-8ddd-eeeeffff0001";
const GUID = "7df9b905-18be-4353-8355-e4e44cbd546b";
const SOURCE_BYTES = 1_819_005;

const assert = (condition: boolean, message: string): void => {
  if (!condition) throw new Error(message);
};

const cronRequest = (): Request =>
  new Request("https://internal/event-cover-video-reaper", {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` },
  });

const jobRow = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => ({
  id: JOB_ID,
  status: "source_uploading",
  provider: "bunny",
  source_asset_id: GUID,
  source_public_id: GUID,
  applied_at: null,
  reaped_at: null,
  // Well inside the 12h stall window, so nothing below can be attributed to
  // the #2905 stall deadline — only to the #3040 sweep.
  created_at: new Date(Date.now() - 90 * 60 * 1000).toISOString(),
  source_bytes: SOURCE_BYTES,
  tus_resource_url: "https://tus.example.test/resource",
  tus_expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  ...overrides,
});

const makeClient = (job: Record<string, unknown>) => {
  let current = job;
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: (name: string, args: Record<string, unknown>) => {
      rpcs.push({ name, args });
      if (name === "cover_video_claim_reconcile_jobs") {
        // Faithful: the claim RPC does NOT hand back an ordinary
        // `source_uploading` row. That is exactly the hole #3040 closes.
        return Promise.resolve({ data: [], error: null });
      }
      if (name === "cover_video_transition_job") {
        const from = args.p_from_statuses as string[];
        const to = String(args.p_to_status);
        if (from.includes(String(current.status))) {
          current = {
            ...current,
            ...(args.p_patch as Record<string, unknown>),
            status: to,
          };
        }
        return Promise.resolve({ data: current, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from: () => ({
      select: () => {
        const scan = {
          is: () => scan,
          not: () => scan,
          limit: () => Promise.resolve({ data: [current], error: null }),
        };
        return scan;
      },
      update: (patch: Record<string, unknown>) => ({
        eq: () => {
          current = { ...current, ...patch };
          return Promise.resolve({ data: current, error: null });
        },
      }),
    }),
  };
  return {
    client,
    rpcs,
    get row() {
      return current;
    },
  };
};

const deps = (stub: ReturnType<typeof makeClient>, destroys: { n: number }) => ({
  bunnyFindVideoByTitle: () =>
    Promise.resolve({ ok: true as const, guid: null }),
  bunnyGetVideo: () =>
    Promise.resolve({
      ok: true as const,
      video: {
        guid: GUID,
        status: 2,
        length: null,
        // Still encoding: storageSize is a POST-encode signal and must not
        // influence anything the sweep decides.
        storageSize: 0,
        availableResolutions: null,
        encodeProgress: 0,
        outputCodecs: null,
        originalHash: null,
      },
    }),
  destroyCoverVideoAsset: () => {
    destroys.n += 1;
    return Promise.resolve({ ok: true as const });
  },
  serviceRoleClient: () => stub.client,
});

const withTusHead = async (
  offset: number,
  run: () => Promise<void>,
): Promise<void> => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, {
        status: 200,
        headers: {
          "upload-offset": String(offset),
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

Deno.test("#3040 an abandoned source_uploading job whose transfer COMPLETED is recovered, not killed", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
  const stub = makeClient(jobRow());
  const destroys = { n: 0 };
  await withTusHead(SOURCE_BYTES, async () => {
    const response = await handleReaper(
      cronRequest(),
      deps(stub, destroys) as never,
    );
    const body = await response.json();
    assert(body.ok === true, `reaper tick failed: ${JSON.stringify(body)}`);
    assert(
      body.sweptSourceUploading === 1,
      `sweep touched ${body.sweptSourceUploading} jobs, expected 1`,
    );
  });
  // The transfer is proven complete by Bunny's own HEAD, so the ONLY thing that
  // was missing is the acknowledgement. Advance it — a matrix edge that already
  // exists — and let the normal promotion path finish the job.
  assert(
    stub.row.status === "source_uploaded",
    `abandoned-but-complete job ended at ${stub.row.status}, not source_uploaded`,
  );
  assert(
    stub.row.tus_upload_offset === SOURCE_BYTES,
    "the recovery did not persist the offset Bunny's HEAD proved",
  );
  assert(
    stub.row.failure_code === undefined || stub.row.failure_code === null,
    `a recoverable job was failed with ${stub.row.failure_code}`,
  );
  // #3040 invariant 1. Bunny is mid-encode (API status 2) — deleting here is
  // exactly the #3039 destruction this umbrella exists to end.
  assert(
    destroys.n === 0,
    `the sweep destroyed ${destroys.n} provider assets while Bunny was encoding`,
  );
  // The job is NOT promoted straight to a cover: `source_uploaded` still has to
  // pass the webhook's source_sha256/originalHash identity check before any
  // `ready`, so the #2967 interlock is intact.
  assert(
    stub.row.status !== "ready" && stub.row.status !== "applied",
    "the sweep published a source it never verified",
  );
});

Deno.test("#3040 an abandoned source_uploading job with a DEAD transport gets a real failure_code", async () => {
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", SERVICE_ROLE_KEY);
  const stub = makeClient(
    jobRow({
      // The TUS lease died an hour ago; those bytes can never be re-offered.
      tus_expires_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    }),
  );
  const destroys = { n: 0 };
  // A genuinely partial transfer: 512 of 1,819,005 bytes.
  await withTusHead(512, async () => {
    const response = await handleReaper(
      cronRequest(),
      deps(stub, destroys) as never,
    );
    const body = await response.json();
    assert(body.ok === true, `reaper tick failed: ${JSON.stringify(body)}`);
    assert(
      body.sweptSourceUploading === 1,
      `sweep touched ${body.sweptSourceUploading} jobs, expected 1`,
    );
  });
  assert(
    stub.row.status === "failed",
    `dead-transport job ended at ${stub.row.status}, not failed`,
  );
  // Invariant 6: a terminal failure ALWAYS carries a failure_code. The
  // production row this replaces sat 24h+ with failure_code NULL.
  assert(
    stub.row.failure_code === "source_transport_expired",
    `expected source_transport_expired, got ${stub.row.failure_code}`,
  );
  // Reclamation is legitimate here and only here: the row is terminal-failed,
  // and it happens in the reaper's own destroy loop with provider truth read.
  assert(
    stub.row.reaped_at != null,
    "a terminally failed abandoned job was never reclaimed",
  );
});
