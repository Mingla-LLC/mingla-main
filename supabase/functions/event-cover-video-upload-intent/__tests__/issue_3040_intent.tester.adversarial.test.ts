// Issue #3040 — INDEPENDENT TESTER adversarial suite for upload-intent.
// Written by the tester, not the implementor. Boundaries and precedence the
// implementor suites do not pin:
//   I1  a build-37 body is told to update BEFORE any other validation can
//       answer with a raw code (missing brand, missing event, malformed op id),
//       and the warn line never carries more than 80 chars of user agent.
//   I2  the 5 s ad minimum at its exact edges (4,900 ms refused, 5,000 ms
//       accepted), and never applied to a 1 s cover.
//   I3  the 60.0–60.5 s band: the client's 500 ms tolerance is CLIENT-only; the
//       edge stays strict at 60,000 ms (60,001 and 60,500 refused, 60,000 ok).
//
// Invariant I-VIDEO-OLD-CLIENT-TOLD (declared in supabase/functions/event-cover-video-upload-intent/__tests__/issue_3040_old_client_426.test.ts): a too-old client always gets human update copy first, whatever else is wrong with its body
// Invariant I-AD-VIDEO-MIN-5S (declared in supabase/functions/event-cover-video-upload-intent/__tests__/issue_3040_ad_min_duration.test.ts): the edge refuses an ad video under 5,000 ms and accepts exactly 5,000 ms; covers have no minimum
// Invariant I-VIDEO-LIMITS-PARITY (declared in packages/video-upload/__tests__/purity_and_parity.test.mjs): the edge duration cap is strict 60,000 ms; the 500 ms tolerance never reaches the server
//
// FAILS ON REVERT:
//   I1  move the clientOperationId/426 check below the brand/event checks, or
//       drop the 80-char user-agent slice
//   I2  `<` changed to `<=` (5,000 refused) or the ad minimum removed
//   I3  the server adopting the client tolerance (cap 60,500)
import { assert, BRAND, baseBody, call, captureWarnings, makeDeps } from "./issue3040_intentHarness.ts";

const UPDATE_COPY = "Update Mingla Host";

const wiredDeps = () => {
  const harness = makeDeps({});
  harness.deps.extendTransportLease = () => Promise.resolve({ ok: true });
  return harness;
};

Deno.test("I1 #3040 a build-37 body hears 'update' first, whatever else is wrong with it", async () => {
  const legacyBodies: Array<[string, Record<string, unknown>]> = [
    ["brand cover, no brand id", { target: "brand", brandId: undefined, eventId: undefined, clientOperationId: undefined }],
    ["event cover, no event id", { eventId: undefined, clientOperationId: undefined }],
    ["malformed operation id", { clientOperationId: "not-a-uuid" }],
    ["no sha256, no trim", { clientOperationId: undefined, sourceSha256: undefined, trimStartMs: undefined, trimEndMs: undefined }],
  ];
  for (const [name, overrides] of legacyBodies) {
    const { deps, captured } = wiredDeps();
    const response = await call(baseBody(overrides), deps);
    const payload = await response.json();
    assert(response.status === 426, `${name}: got ${response.status} ${JSON.stringify(payload)}`);
    assert(payload.error === "client_version_required", `${name}: ${payload.error}`);
    assert(typeof payload.detail === "string" && payload.detail.includes(UPDATE_COPY), `${name}: detail ${payload.detail}`);
    assert(captured.rpcs.length === 0, `${name}: a legacy body reached the database`);
  }
});

Deno.test("I1 #3040 the 426 warn line truncates a hostile user agent to 80 chars", async () => {
  const { deps } = wiredDeps();
  const longAgent = `Mozilla/5.0 ${"A".repeat(500)}`;
  const warnings = await captureWarnings(async () => {
    await call(baseBody({ clientOperationId: undefined }), deps, { "user-agent": longAgent });
  });
  const line = warnings.find((w) => w.includes('"stage":"client_version_required"'));
  assert(line !== undefined, `no warn line: ${warnings.join("\n")}`);
  const match = /"userAgent":"([^"]*)"/.exec(line);
  assert(match !== null, `no userAgent field: ${line}`);
  assert(match[1].length <= 80, `user agent logged at ${match[1].length} chars`);
});

const adBody = (durationMs: number) =>
  baseBody({
    target: "ad_creative",
    eventId: undefined,
    brandId: BRAND,
    draftOwnerKey: "host-ad:draft-3040",
    sourceDurationMs: durationMs,
    trimEndMs: durationMs,
  });

Deno.test("I2 #3040 the ad minimum is exact: 4,900 ms refused, 5,000 ms accepted", async () => {
  {
    const { deps, captured } = wiredDeps();
    const response = await call(adBody(4_900), deps);
    const payload = await response.json();
    assert(response.status === 422 && payload.detail === "ad_video_too_short", `4900: ${response.status} ${JSON.stringify(payload)}`);
    assert(captured.rpcs.length === 0, "a 4.9 s ad video reached the database");
  }
  {
    const { deps, captured } = wiredDeps();
    const response = await call(adBody(5_000), deps);
    const payload = await response.json();
    assert(response.status === 200, `5000: ${response.status} ${JSON.stringify(payload)}`);
    const create = captured.rpcs.find((r) => r.name === "cover_video_create_or_replay_job");
    assert(create?.args.p_source_duration_ms === 5_000 && create?.args.p_target_kind === "ad_creative", JSON.stringify(create?.args));
  }
  {
    const { deps } = wiredDeps();
    const response = await call(baseBody({ sourceDurationMs: 1_000, trimEndMs: 1_000 }), deps);
    assert(response.status === 200, `a 1 s cover was refused: ${response.status}`);
  }
});

Deno.test("I3 #3040 the edge is strict at 60,000 ms: the client's 500 ms tolerance never reaches the server", async () => {
  {
    const { deps } = wiredDeps();
    const response = await call(baseBody({ sourceDurationMs: 60_000, trimEndMs: 60_000 }), deps);
    assert(response.status === 200, `60,000 ms was refused: ${response.status}`);
  }
  for (const ms of [60_001, 60_500]) {
    const { deps, captured } = wiredDeps();
    const response = await call(baseBody({ sourceDurationMs: ms, trimEndMs: ms }), deps);
    assert(response.status === 422, `${ms} ms was accepted by the edge: ${response.status}`);
    assert(captured.rpcs.length === 0, `${ms} ms reached the database`);
  }
});

