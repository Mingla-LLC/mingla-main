// Issue #3645 — classification of a charge_authorization answer.
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { classifyPaystackChargeResponse, type PaystackChargeAuthorizationResponse } from "../paystack.ts";

const r = (httpStatus: number, body: unknown): PaystackChargeAuthorizationResponse => ({ kind: "response", httpStatus, body });

Deno.test("#3645 classify: success", () => {
  const c = classifyPaystackChargeResponse(r(200, {
    status: true, data: { status: "success", id: 123, amount: 270625, fees: 4060, gateway_response: "Approved" },
  }));
  assertEquals(c, { outcome: "succeeded", transactionId: "123", amountSubunits: 270625, feesSubunits: 4060, gatewayResponse: "Approved" });
});

Deno.test("#3645 classify: paused with an approval link, and send_otp", () => {
  const paused = classifyPaystackChargeResponse(r(200, {
    status: true, data: { paused: true, status: "pending", authorization_url: "https://checkout.paystack.com/x" },
  }));
  assertEquals(paused.outcome, "paused");
  assertEquals(paused.outcome === "paused" && paused.approvalUrl, "https://checkout.paystack.com/x");
  const otp = classifyPaystackChargeResponse(r(200, { status: true, data: { status: "send_otp" } }));
  assertEquals(otp.outcome === "paused" && otp.approvalUrl, null);
});

Deno.test("#3645 classify: declined and an unusable authorization", () => {
  const declined = classifyPaystackChargeResponse(r(200, { status: true, data: { status: "failed", gateway_response: "Declined" } }));
  assertEquals(declined, { outcome: "failed", gatewayResponse: "Declined", authorizationUnusable: false, transactionId: null });
  const invalid = classifyPaystackChargeResponse(r(400, { status: false, message: "Invalid authorization code" }));
  assertEquals(invalid.outcome === "failed" && invalid.authorizationUnusable, true);
  const notReusable = classifyPaystackChargeResponse(r(400, { status: false, message: "Authorization is not reusable" }));
  assertEquals(notReusable.outcome === "failed" && notReusable.authorizationUnusable, true);
});

Deno.test("#3645 classify: 5xx, timeout, network, garbage and still-running are unknown", () => {
  for (const resp of [
    r(500, { status: false }),
    r(503, null),
    { kind: "network_error", message: "timeout" } as const,
    { kind: "network_error", message: "network_error" } as const,
    r(200, "not json"),
    r(200, { status: true, data: { status: "pending" } }),
    r(200, { status: true, data: { status: "processing" } }),
    r(200, { status: true, data: { status: "queued" } }),
  ]) {
    assertEquals(classifyPaystackChargeResponse(resp).outcome, "unknown", JSON.stringify(resp));
  }
});
