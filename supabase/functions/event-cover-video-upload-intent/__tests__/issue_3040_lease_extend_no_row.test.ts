// Issue #3040 rework 1 (D-7) — a lease extension that moved no row is not a
// success. The RPC answers NULL (or an all-null projection) when the job is no
// longer source_uploading; the intent must answer retryable instead of handing
// out a signature the server will not honour.
// Invariant I-VIDEO-READY-HAS-OWNER (declared in supabase/functions/_shared/__tests__/coverVideoReadyOwner.issue3040.test.ts): the transfer bound follows the latest signature the server handed out, and only a moved row counts
//
// FAILS ON REVERT: treat `error === null` alone as success again and the
// first two cases report ok.
import { extendTransportLease } from "../index.ts";
import { assert, baseBody, call, makeDeps } from "./issue3040_intentHarness.ts";

const answer = (data: unknown) => ({ rpc: () => Promise.resolve({ data, error: null }) });

Deno.test("#3040 D-7 a lease extension that matched no row is not ok", async () => {
  assert(!(await extendTransportLease(answer(null), "job", new Date().toISOString())).ok, "NULL row reported ok");
  assert(!(await extendTransportLease(answer({ id: null, status: null }), "job", new Date().toISOString())).ok, "all-null projection reported ok");
  assert((await extendTransportLease(answer({ id: "job" }), "job", new Date().toISOString())).ok, "a moved row was refused");
});

Deno.test("#3040 D-7 the intent answers retryable when the lease could not be moved", async () => {
  const harness = makeDeps({ rpc: { cover_video_extend_transport_lease: () => ({ data: null, error: null }) } });
  harness.deps.extendTransportLease = extendTransportLease;
  const response = await call(baseBody(), harness.deps);
  const payload = await response.json();
  assert(response.status === 503 && payload.error === "transport_lease_extend_failed" && payload.retryable === true, JSON.stringify(payload));
});
