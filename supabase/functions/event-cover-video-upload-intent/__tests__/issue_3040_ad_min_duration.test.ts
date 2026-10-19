// Issue #3040 (T-ADMIN5S edge half, E-3a/h) — the ad_creative target.
// MINGLA-INVARIANT: I-AD-VIDEO-MIN-5S | issue #3040 | an ad_creative source shorter than 5 s is refused by the edge; covers have no minimum
//
// FAILS ON REVERT: drop the AD_MIN_DURATION_MS check and the 4999 ms ad video
// below reaches the database; drop the owner-key rules and a house upload can
// be filed under another admin or without one.
import { assert, BRAND, baseBody, call, makeDeps, USER } from "./issue3040_intentHarness.ts";

const adBody = (overrides: Record<string, unknown> = {}) =>
  baseBody({
    target: "ad_creative",
    eventId: undefined,
    brandId: undefined,
    draftOwnerKey: `admin-library:${USER}`,
    sourceDurationMs: 8_000,
    trimEndMs: 8_000,
    ...overrides,
  });

Deno.test("#3040 an ad video under 5 seconds is refused before any database work", async () => {
  const { deps, captured } = makeDeps({});
  const response = await call(adBody({ sourceDurationMs: 4_999, trimEndMs: 4_999 }), deps);
  const payload = await response.json();
  assert(response.status === 422 && payload.error === "validation_error" && payload.detail === "ad_video_too_short", JSON.stringify(payload));
  assert(captured.rpcs.length === 0, "a too-short ad video reached the database");
});

Deno.test("#3040 a 3 second cover video is not refused (covers have no minimum)", async () => {
  const { deps } = makeDeps({});
  deps.extendTransportLease = () => Promise.resolve({ ok: true });
  const response = await call(baseBody({ sourceDurationMs: 3_000, trimEndMs: 3_000 }), deps);
  assert(response.status === 200, `a 3 s cover was refused: ${response.status}`);
});

Deno.test("#3040 a house ad upload is brandless, filed under the calling admin, published_manual", async () => {
  const { deps, captured } = makeDeps({ job: { id: "job-ad", status: "source_uploading", provider: "bunny", brand_id: null, target_kind: "ad_creative", source_asset_id: "guid-ad-3040", tus_resource_url: "https://video.bunnycdn.com/tusupload/r", tus_upload_offset: 0 } });
  deps.extendTransportLease = () => Promise.resolve({ ok: true });
  const seen: unknown[] = [];
  deps.requireCoverVideoTargetManager = (_s: unknown, selector: unknown) => {
    seen.push(selector);
    return Promise.resolve({ target: selector });
  };
  const response = await call(adBody({ applyMode: "draft_auto" }), deps);
  assert(response.status === 200, `house upload refused: ${response.status}`);
  const create = captured.rpcs.find((r) => r.name === "cover_video_create_or_replay_job");
  assert(create?.args.p_target_kind === "ad_creative" && create?.args.p_brand_id === null, JSON.stringify(create?.args));
  assert(create?.args.p_draft_owner_key === `admin-library:${USER}` && create?.args.p_apply_mode === "published_manual", "owner key or apply mode wrong");
  assert(JSON.stringify(seen[0]).includes('"brandId":null'), "auth did not see a brandless selector");
});

Deno.test("#3040 ad owner keys must match the caller and the brand", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["house key for another admin", { draftOwnerKey: "admin-library:someone-else-id" }],
    ["house key with a brand", { brandId: BRAND }],
    ["host ad without a brand", { draftOwnerKey: "host-ad:draft-123" }],
    ["unparseable key", { draftOwnerKey: "draft-123", brandId: BRAND }],
  ];
  for (const [name, overrides] of cases) {
    const { deps, captured } = makeDeps({});
    const response = await call(adBody(overrides), deps);
    const payload = await response.json();
    assert(response.status === 400 && payload.detail === "draft_owner_key_invalid", `${name}: ${response.status} ${JSON.stringify(payload)}`);
    assert(captured.rpcs.length === 0, `${name}: reached the database`);
  }
  const { deps } = makeDeps({});
  deps.extendTransportLease = () => Promise.resolve({ ok: true });
  const hostAd = await call(adBody({ draftOwnerKey: "host-ad:draft-123", brandId: BRAND }), deps);
  assert(hostAd.status === 200, `a brand host-ad upload was refused: ${hostAd.status}`);
});

Deno.test("#3040 a source over 100 MB is refused with its own name", async () => {
  const { deps } = makeDeps({});
  const response = await call(baseBody({ sourceBytes: 104_857_601 }), deps);
  const payload = await response.json();
  assert(response.status === 422 && payload.detail === "source_too_large", JSON.stringify(payload));
});
