import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";

const serviceUrl = new URL("../services/adminMoneyActService.js", import.meta.url);
const pageUrl = new URL("../pages/BusinessOrdersPage.jsx", import.meta.url);
const serviceSource = readFileSync(serviceUrl, "utf8");
const pageSource = readFileSync(pageUrl, "utf8");

async function loadServiceWith(writeEdge) {
  globalThis.__issue1175WriteEdge = writeEdge;
  const executableSource = serviceSource.replace(
    /import \{ callAdminWriteRpc, invokeAdminWriteEdge \} from "\.\/adminWriteService";/,
    [
      "const callAdminWriteRpc = () => { throw new Error('not used'); };",
      "const invokeAdminWriteEdge = globalThis.__issue1175WriteEdge;",
    ].join("\n"),
  );
  return import(`data:text/javascript;base64,${Buffer.from(executableSource).toString("base64")}#${Date.now()}`);
}

test("one mounted Admin refund intent reuses its exact key after a retryable failure", async () => {
  const calls = [];
  const service = await loadServiceWith(async (name, body, options) => {
    calls.push({ name, body, options });
    if (calls.length === 1) return { data: null, error: new Error("retryable persistence failure") };
    return { data: { status: "processed" }, error: null };
  });
  const idempotencyKey = service.createAdminRefundIdempotencyKey();
  const request = {
    order_id: "order-1175",
    lines: [{ order_line_item_id: "line-1", quantity: 1, amount_cents: 5000 }],
    reason: "Buyer requested a refund",
    idempotencyKey,
  };

  const first = await service.refundOrder(request);
  assert.ok(first.error, "the injected first response must remain retryable");
  const retry = await service.refundOrder(request);
  assert.equal(retry.error, null);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.options.idempotencyKey),
    [idempotencyKey, idempotencyKey],
    "an inline retry must address the original refund manifest",
  );
  assert.deepEqual(calls[0].body, calls[1].body, "the canonical refund request must not drift on retry");
});

test("closing or completing an intent gives the next mounted refund a new key", async () => {
  const service = await loadServiceWith(async () => ({ data: {}, error: null }));
  const firstMountedIntent = service.createAdminRefundIdempotencyKey();
  const nextMountedIntent = service.createAdminRefundIdempotencyKey();

  assert.ok(firstMountedIntent);
  assert.ok(nextMountedIntent);
  assert.notEqual(firstMountedIntent, nextMountedIntent);
});

test("refundOrder requires and forwards the caller key without a random fallback", async () => {
  const calls = [];
  const service = await loadServiceWith(async (...args) => {
    calls.push(args);
    return { data: {}, error: null };
  });

  await assert.rejects(
    service.refundOrder({ order_id: "order-1175", lines: [], reason: "Required reason" }),
    /idempotencyKey is required/,
  );
  assert.equal(calls.length, 0, "a missing key must fail before the write seam");

  const callerKey = "caller-owned-key-1175";
  await service.refundOrder({
    order_id: "order-1175",
    lines: [],
    reason: "Required reason",
    idempotencyKey: callerKey,
  });
  assert.equal(calls[0][2].idempotencyKey, callerKey);

  const refundBody = serviceSource.match(
    /export async function refundOrder[\s\S]*?\n}\n\n\/\/ ── W2-B/,
  )?.[0] ?? "";
  assert.doesNotMatch(refundBody, /randomUUID/, "refundOrder must never rotate the caller's key");
});

test("RefundModal owns the key lazily and its existing mount boundary defines reset", () => {
  assert.match(
    pageSource,
    /const \[idempotencyKey\] = useState\(createAdminRefundIdempotencyKey\);/,
    "the key factory must run only when a refund intent mounts",
  );
  assert.match(
    pageSource,
    /refundOrder\(\{[\s\S]*?order_id: order\.id,[\s\S]*?lines,[\s\S]*?reason,[\s\S]*?idempotencyKey,[\s\S]*?\}\)/,
    "every confirmation must pass the mounted intent's key",
  );
  assert.match(
    pageSource,
    /\{refundOpen && \(\s*<RefundModal/,
    "close/success must unmount the old intent so a later open creates a new key",
  );
});
