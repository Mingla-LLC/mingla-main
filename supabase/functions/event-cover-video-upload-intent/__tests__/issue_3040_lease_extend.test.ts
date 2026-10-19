// Issue #3040 (T-B7, B-7) — the server lease follows every signature it hands out.
// MINGLA-INVARIANT: I-VIDEO-READY-HAS-OWNER | issue #3040 | the transfer bound follows the latest signature the server handed out
//
// FAILS ON REVERT: drop the extendTransportLease step before the transport
// response and the first test sees a 200 with no lease extension.
import { extendTransportLease } from "../index.ts";
import { assert, baseBody, call, EXPIRE, makeDeps } from "./issue3040_intentHarness.ts";

const wired = (rpcResult: { data: unknown; error: unknown }) => {
  const harness = makeDeps({ rpc: { cover_video_extend_transport_lease: () => rpcResult } });
  harness.deps.extendTransportLease = extendTransportLease;
  return harness;
};

Deno.test("#3040 a replay extends the transport lease to the fresh signature before responding", async () => {
  const { deps, captured } = wired({ data: { id: "job-3040-intent" }, error: null });
  const response = await call(baseBody(), deps);
  const payload = await response.json();
  assert(response.status === 200, `got ${response.status}`);
  assert(payload.upload?.fields?.AuthorizationExpire === String(EXPIRE), "signature changed");
  const rpc = captured.rpcs.find((r) => r.name === "cover_video_extend_transport_lease");
  assert(rpc !== undefined, `lease not extended: ${captured.rpcs.map((r) => r.name).join(",")}`);
  assert(rpc.args.p_job_id === "job-3040-intent", "wrong job");
  assert(rpc.args.p_expires_at === new Date(EXPIRE * 1000).toISOString(), `wrong expiry ${rpc.args.p_expires_at}`);
});

Deno.test("#3040 a failed lease extension is retryable, never a signature the server will refuse", async () => {
  const { deps } = wired({ data: null, error: { code: "57014", message: "statement timeout" } });
  const response = await call(baseBody(), deps);
  const payload = await response.json();
  assert(
    response.status === 503 && payload.error === "transport_lease_extend_failed" && payload.retryable === true,
    JSON.stringify(payload),
  );
});

Deno.test("#3040 a lease RPC that is not deployed yet degrades instead of failing the intent", async () => {
  const { deps } = wired({ data: null, error: { code: "PGRST202", message: "not found" } });
  const response = await call(baseBody(), deps);
  assert(response.status === 200, `a missing lease RPC failed the intent: ${response.status}`);
});
