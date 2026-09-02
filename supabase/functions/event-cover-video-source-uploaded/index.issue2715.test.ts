import { handleEventCoverVideoSourceUploaded } from "./index.ts";

const JOB_ID = "11a18413-bfbf-4087-9ba7-45f70deba0f3";
const USER_ID = "44a18413-bfbf-4087-9ba7-45f70deba0f3";
const job = {
  id: JOB_ID,
  status: "source_uploading",
  target_kind: "venue_draft",
  event_id: null,
  brand_id: "22a18413-bfbf-4087-9ba7-45f70deba0f3",
  venue_id: null,
  draft_owner_key: "draft-a",
  requested_by: USER_ID,
  source_asset_id: "guid",
  source_bytes: 1024,
  tus_resource_url: "https://tus/resource",
  provider_payload: {},
  tus_upload_length: 1024,
};
const assert = (condition: boolean, message: string) => {
  if (!condition) throw new Error(message);
};
const request = () =>
  new Request("https://test/source-uploaded", {
    method: "POST",
    headers: {
      Authorization: "Bearer token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jobId: JOB_ID,
      target: "venue_draft",
      brandId: job.brand_id,
    }),
  });

const harness = (
  options: {
    offset: number;
    ownerAllowed?: boolean;
    casWinner?: Record<string, unknown>;
  },
) => {
  const updates: Record<string, unknown>[] = [];
  let providerReads = 0, selectReads = 0;
  const client = {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => {
            selectReads += 1;
            return Promise.resolve({
              data: selectReads > 1 && options.casWinner
                ? options.casWinner
                : job,
              error: null,
            });
          },
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: () => ({
          eq: () => ({
            select: () => ({
              maybeSingle: () => {
                updates.push(patch);
                return Promise.resolve({
                  data: options.casWinner ? null : { ...job, ...patch },
                  error: null,
                });
              },
            }),
          }),
        }),
      }),
    }),
  };
  return {
    updates,
    get providerReads() {
      return providerReads;
    },
    deps: {
      bunnyGetVideo: () => {
        providerReads += 1;
        return Promise.resolve({
          ok: true as const,
          video: {
            guid: "guid",
            status: 2,
            length: 12,
            storageSize: 1024,
            availableResolutions: null,
            encodeProgress: 0,
            outputCodecs: null,
            originalHash: null,
          },
        });
      },
      bunnyPresignTusUpload: () =>
        Promise.resolve({
          authorizationSignature: "sig",
          authorizationExpire: 9999999999,
          libraryId: "lib",
          videoId: "guid",
          tusEndpoint: "https://tus",
        }),
      destroyCoverVideoAsset: () => Promise.resolve({ ok: true as const }),
      requireUserId: () => Promise.resolve(USER_ID),
      requireCoverVideoTargetManager: () =>
        Promise.resolve(
          options.ownerAllowed === false
            ? new Response(JSON.stringify({ error: "forbidden" }), {
              status: 403,
            })
            : { target: {} },
        ),
      serviceRoleClient: () => client,
    },
  };
};

Deno.test("#2715 incomplete TUS acknowledgement is retryable and never fabricates full offset", async () => {
  const h = harness({ offset: 512 });
  const old = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, {
        status: 200,
        headers: { "upload-offset": "512", "upload-length": "1024" },
      }),
    )) as typeof fetch;
  try {
    const response = await handleEventCoverVideoSourceUploaded(
      request(),
      h.deps as never,
    );
    assert(response.status === 409, `expected 409, got ${response.status}`);
    assert(h.updates.length === 0, "incomplete upload mutated job");
  } finally {
    globalThis.fetch = old;
  }
});

Deno.test("#2715 exact completed TUS HEAD advances the same venue-draft job", async () => {
  const h = harness({ offset: 1024 });
  const old = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, {
        status: 200,
        headers: { "upload-offset": "1024", "upload-length": "1024" },
      }),
    )) as typeof fetch;
  try {
    const response = await handleEventCoverVideoSourceUploaded(
      request(),
      h.deps as never,
    );
    const body = await response.json();
    assert(response.status === 200, `expected 200, got ${response.status}`);
    assert(body.status === "source_uploaded", "job did not advance");
    assert(
      h.updates.some((p) =>
        p.tus_upload_offset === 1024 && p.status === "source_uploaded"
      ),
      "authoritative offset/status not persisted",
    );
  } finally {
    globalThis.fetch = old;
  }
});

Deno.test("#2715 venue-draft ownership rejects before provider verification", async () => {
  const h = harness({ offset: 1024, ownerAllowed: false });
  const response = await handleEventCoverVideoSourceUploaded(
    request(),
    h.deps as never,
  );
  assert(response.status === 403, `expected 403, got ${response.status}`);
  assert(
    h.providerReads === 0,
    "provider read leaked another user's draft job",
  );
  assert(h.updates.length === 0, "ownership failure mutated job");
});

Deno.test("#2715 source-upload CAS loss rereads and projects the canonical winner", async () => {
  const canonical = {
    ...job,
    status: "ready",
    processed_url: "https://cdn.example.com/winner.mp4",
    application_version: 9,
  };
  const h = harness({ offset: 1024, casWinner: canonical });
  const old = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, {
        status: 200,
        headers: { "upload-offset": "1024", "upload-length": "1024" },
      }),
    )) as typeof fetch;
  try {
    const response = await handleEventCoverVideoSourceUploaded(
      request(),
      h.deps as never,
    );
    const body = await response.json();
    assert(
      response.status === 200,
      `expected canonical 200, got ${response.status}`,
    );
    assert(
      body.status === "ready" &&
        body.processedUrl === "https://cdn.example.com/winner.mp4",
      "CAS loser did not project canonical ready truth",
    );
  } finally {
    globalThis.fetch = old;
  }
});

// [TEST-MOD-APPROVED #3040] SUPERSEDED ASSERTION, named precisely.
//
// This test asserted that a COMPLETED TUS transfer whose Bunny `storageSize` is
// still 0 "stays retryable canonical truth" — i.e. remains `source_uploading`.
// That is the #3039 defect stated as a requirement.
//
// `storageSize` only becomes non-zero when ENCODING finishes (production job
// e055c562 reported storageSize = 14,808,154 together with bunny_status = 4
// Finished at 21s), so this assertion made acknowledgement of a TRANSFER wait
// for the whole ENCODE. #2967 then bounded that wait and destroyed the asset on
// breach, deleting videos Bunny was still working on.
//
// The invariant #2715 actually owns — the acknowledgement must never fabricate
// an offset it did not prove, and must never destroy provider work — is kept
// and asserted below in a stronger form: the persisted offset must equal the
// value Bunny's own HEAD returned.
Deno.test("#3040 completed TUS advances the job even while Bunny storage metadata is still zero", async () => {
  const h = harness({ offset: 1024 });
  h.deps.bunnyGetVideo = () =>
    Promise.resolve({
      ok: true as const,
      video: {
        guid: "guid",
        status: 0,
        length: 0,
        storageSize: 0,
        availableResolutions: null,
        encodeProgress: 0,
        outputCodecs: null,
        originalHash: null,
      },
    });
  const old = globalThis.fetch;
  globalThis.fetch = (() =>
    Promise.resolve(
      new Response(null, {
        status: 200,
        headers: { "upload-offset": "1024", "upload-length": "1024" },
      }),
    )) as typeof fetch;
  try {
    const response = await handleEventCoverVideoSourceUploaded(
      request(),
      h.deps as never,
    );
    const body = await response.json();
    assert(response.status === 200, `completed transfer returned ${response.status}`);
    assert(
      body.status === "source_uploaded",
      "a fully transferred source was held back by post-encode metadata",
    );
    assert(h.updates.length === 1, `expected one write, got ${h.updates.length}`);
    assert(
      h.updates.every((p) => p.tus_upload_offset === 1024),
      "the acknowledgement persisted an offset Bunny's HEAD did not prove",
    );
  } finally {
    globalThis.fetch = old;
  }
});
