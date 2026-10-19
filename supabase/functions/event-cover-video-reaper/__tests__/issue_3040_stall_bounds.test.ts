// Issue #3040 (T-B10, T-B12, B-10, B-12) — encode bounds come from the final
// byte, a vanished provider asset fails at once, and the reaper's reads are
// ordered so old applied history can never starve live work.
// Invariant I-VIDEO-READY-HAS-OWNER (declared in supabase/functions/_shared/__tests__/coverVideoReadyOwner.issue3040.test.ts): every non-terminal job has a finite bound measured from its own clock
//
// FAILS ON REVERT: restore the 12 h created_at-only stall (or gate a 404 on
// age) and the first two tests fail; restore the unordered `.limit(1000)`
// candidate read without a status filter and the third test never reaches the
// failed job behind 1001 applied rows.
import {
  COVER_VIDEO_UPLOADED_STALL_MS,
  evaluateCoverVideoStall,
} from "../index.ts";
import { assert, isoAgo } from "../../_shared/__tests__/issue3040_fakeSupabase.ts";
import { makeReaper, quietly } from "./issue3040_reaperHarness.ts";

const MIN = 60_000;

Deno.test("#3040 the encode bound is 10 minutes from the final byte", () => {
  const now = Date.now();
  assert(COVER_VIDEO_UPLOADED_STALL_MS === 10 * MIN, "bound changed");
  const late = evaluateCoverVideoStall({
    status: "processing", createdAt: isoAgo(12 * MIN), sourceUploadedAt: isoAgo(11 * MIN), nowMs: now, providerRead: "non_terminal",
  });
  assert(late.stalled && late.failureCode === "processing_stalled", JSON.stringify(late));
  const young = evaluateCoverVideoStall({
    status: "processing", createdAt: isoAgo(60 * MIN), sourceUploadedAt: isoAgo(9 * MIN), nowMs: now, providerRead: "non_terminal",
  });
  assert(!young.stalled, "a 9-minute encode was stalled (the transfer time must not count)");
  const outage = evaluateCoverVideoStall({
    status: "processing", createdAt: isoAgo(60 * MIN), sourceUploadedAt: isoAgo(59 * MIN), nowMs: now, providerRead: "unreadable",
  });
  assert(!outage.stalled, "a provider outage stalled a job");
});

Deno.test("#3040 a provider 404 after the bytes landed fails on the first tick", () => {
  const verdict = evaluateCoverVideoStall({
    status: "processing", createdAt: isoAgo(MIN), sourceUploadedAt: isoAgo(MIN), nowMs: Date.now(), providerRead: "absent",
  });
  assert(verdict.stalled && verdict.failureCode === "provider_asset_missing", JSON.stringify(verdict));
  const uploading = evaluateCoverVideoStall({
    status: "source_uploading", createdAt: isoAgo(MIN), nowMs: Date.now(), providerRead: "absent",
  });
  assert(!uploading.stalled, "an upload still in transfer was failed on a single 404");
});

Deno.test("#3040 1001 applied rows cannot hide a failed job from the reaper", async () => {
  const applied = Array.from({ length: 1001 }, (_, i) => ({
    id: `applied-${String(i).padStart(4, "0")}`,
    status: "applied",
    provider: "bunny",
    target_kind: "event",
    source_asset_id: `guid-applied-${i}`,
    reaped_at: null,
    completed_at: isoAgo(2 * 24 * 60 * MIN),
    created_at: isoAgo(3 * 24 * 60 * MIN),
  }));
  const failed = {
    id: "zz-failed",
    status: "failed",
    provider: "bunny",
    target_kind: "event",
    source_asset_id: "guid-zz-failed",
    failure_code: "provider_failed",
    reaped_at: null,
    completed_at: isoAgo(MIN),
    created_at: isoAgo(2 * MIN),
  };
  const reaper = makeReaper([...applied, failed]);
  const body = await quietly(reaper.tick);
  assert(reaper.destroyed.includes("guid-zz-failed"), "the failed job's asset was never reached");
  assert(!reaper.destroyed.some((guid) => guid.startsWith("guid-applied")), "an applied asset was reaped as terminal");
  assert(body.ok === true, JSON.stringify(body));
});
