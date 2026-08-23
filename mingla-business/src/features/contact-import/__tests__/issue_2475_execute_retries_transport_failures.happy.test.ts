import fs from "node:fs";
import path from "node:path";

// #2475 — a confirm request that never reached the server used to cost the
// person their whole upload.
//
// Live evidence (We Go Again Exhibition, 2026-08-23): three separate attempts,
// every one leaving its batch at `previewed` with `attested_at` null and 0 of
// 212 rows executed. The server was replayed against production and completed
// every shape in under a second, and a raw fetch from the real origin reached
// the function — so the request was dying inside the client, before it was sent.
//
// Two independent properties are pinned here. Either alone would have saved the
// import; the pair is defence in depth.

const root = path.resolve(__dirname, "../../../../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const client = read("mingla-business/src/services/supabase.ts");
const service = read("mingla-business/src/services/contactImportService.ts");

describe("#2475 a lost request does not cost the upload", () => {
  it("survives a STOLEN auth lock, not just a timed-out acquire", () => {
    // navigatorLock rejects two ways and only one carries isAcquireTimeout. A
    // stolen held lock aborts with a plain AbortError, which the old code
    // re-threw — so cross-tab bookkeeping killed an unrelated user action.
    expect(client).toContain("isLockBrokenError");
    expect(client).toMatch(
      /isAcquireTimeoutError\(error\)\s*\|\|\s*isLockBrokenError\(error\)/,
    );
  });

  it("still propagates a genuine caller-initiated abort", () => {
    // The lock recovery must not swallow every AbortError — an abort raised by
    // a caller's own AbortSignal is a real cancellation and has to survive.
    expect(client).toMatch(/name !== "AbortError"/);
    expect(client).toMatch(/\/lock\/i\.test\(message\)/);
  });

  it("re-sends an execute that never landed, reusing the idempotency key", () => {
    // Retrying is safe BECAUSE the key is stable: the server guards replay on
    // idempotency_key + execute_request_hash and returns the completed result
    // instead of importing twice. A fresh key per attempt would break that.
    expect(service).toContain("EXECUTE_RETRIES");
    expect(service).toMatch(/idempotencyKey: input\.idempotencyKey/);
    expect(service).toMatch(/attempt === EXECUTE_RETRIES\) throw error/);
  });

  it("never retries a request the server actually answered", () => {
    // A stale preview, a forbidden actor or an invalid payload are real
    // answers. Re-sending them would spam the server and hide a real fault.
    expect(service).toContain("isTransportFailure");
    expect(service).toMatch(/TEMPORARILY_UNAVAILABLE/);
    expect(service).toMatch(/!isTransportFailure\(error\)/);
    // The guard must be an allowlist of transport codes, never a blanket catch.
    expect(service).not.toMatch(/catch[\s\S]{0,80}?attempt < EXECUTE_RETRIES\)\s*continue/);
  });
});
