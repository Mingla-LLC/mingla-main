// Issue #3040 (T-B16, B-16) — a transport is replaced only when the provider
// confirms it holds no bytes, and a failed refresh is a structured, retryable
// answer.
//
// FAILS ON REVERT: restore the DB-offset-only guard (always 0 before
// acknowledgement) and the 5 MB resource below is replaced; remove the
// try/catch and the network failure escapes as an unstructured 500.
import { assert, baseBody, call, makeDeps } from "./issue3040_intentHarness.ts";

const withTusCreate = async (impl: () => Promise<Response>, fn: () => Promise<void>) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl as typeof fetch;
  try {
    await fn();
  } finally {
    globalThis.fetch = original;
  }
};

Deno.test("#3040 refresh is refused while the live TUS resource already holds bytes", async () => {
  const { deps, captured } = makeDeps({});
  deps.extendTransportLease = () => Promise.resolve({ ok: true });
  deps.readTusTransfer = () =>
    Promise.resolve({ kind: "incomplete", uploadOffset: 5_000_000, uploadLength: 6_000_000 });
  let creates = 0;
  await withTusCreate(() => {
    creates += 1;
    return Promise.resolve(new Response(null, { status: 201, headers: { location: "/new" } }));
  }, async () => {
    const response = await call(baseBody({ refreshTransport: true }), deps);
    const payload = await response.json();
    assert(response.status === 409 && payload.error === "transport_has_bytes", JSON.stringify(payload));
    assert(payload.detail?.uploadOffset === 5_000_000, "offset not reported");
  });
  assert(creates === 0, "a transport holding bytes was replaced");
  assert(!captured.rpcs.some((r) => r.name === "cover_video_replace_transport"), "replace RPC ran");
});

Deno.test("#3040 an unreadable provider HEAD refuses the refresh as retryable", async () => {
  const { deps } = makeDeps({});
  deps.readTusTransfer = () => Promise.resolve({ kind: "unreadable", reason: "tus_head_timeout" });
  const response = await call(baseBody({ refreshTransport: true }), deps);
  const payload = await response.json();
  assert(response.status === 503 && payload.error === "transport_refresh_failed" && payload.retryable === true, JSON.stringify(payload));
});

Deno.test("#3040 a network failure creating the new transport is a structured 503", async () => {
  const { deps } = makeDeps({});
  deps.readTusTransfer = () => Promise.resolve({ kind: "incomplete", uploadOffset: 0, uploadLength: 6_000_000 });
  await withTusCreate(() => Promise.reject(new TypeError("connection reset")), async () => {
    const response = await call(baseBody({ refreshTransport: true }), deps);
    const payload = await response.json();
    assert(response.status === 503 && payload.error === "transport_refresh_failed", JSON.stringify(payload));
  });
});
