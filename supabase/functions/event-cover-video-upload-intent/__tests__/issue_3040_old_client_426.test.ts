// Issue #3040 (T-B1, B-1, A-1) — a store build too old for the lane is told, in
// plain words, to update; and the rejection is logged.
// MINGLA-INVARIANT: I-VIDEO-OLD-CLIENT-TOLD | issue #3040 | a client too old for the lane always receives human "update" copy, and the rejection is logged
//
// FAILS ON REVERT: restore `detail: "client_operation_id_required"` (or drop the
// warn line) and the build-37 fixture below sees a raw code with no log.
import { assert, baseBody, call, captureWarnings, makeDeps } from "./issue3040_intentHarness.ts";

Deno.test("#3040 a build-37 upload body gets 426 with human update copy and a log line", async () => {
  const { deps, captured } = makeDeps({});
  // Store build 1.1.6 (37) predates #2715: no clientOperationId, no sha256.
  const legacy = baseBody({ clientOperationId: undefined, sourceSha256: undefined });
  let response: Response | null = null;
  const warnings = await captureWarnings(async () => {
    response = await call(legacy, deps, {
      "x-mingla-app-version": "1.1.6",
      "x-mingla-platform": "android",
      "user-agent": "okhttp/4.12.0",
    });
  });
  const res = response as unknown as Response;
  const payload = await res.json();
  assert(res.status === 426 && payload.error === "client_version_required", `got ${res.status}`);
  assert(typeof payload.detail === "string" && payload.detail.includes("Update Mingla Host"), `detail was ${payload.detail}`);
  assert(payload.detail !== "client_operation_id_required", "detail is still a raw code");
  assert(payload.code === "client_operation_id_required", "machine code moved out of `code`");
  const line = warnings.find((w) => w.includes('"stage":"client_version_required"'));
  assert(line !== undefined && line.includes('"appVersion":"1.1.6"') && line.includes('"platform":"android"'), `no structured warn: ${warnings.join("\n")}`);
  assert(captured.rpcs.length === 0, "a legacy body reached the database");
});
