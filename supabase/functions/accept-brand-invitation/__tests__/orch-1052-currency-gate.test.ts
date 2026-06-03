// ORCH-1052 — accept-brand-invitation currency-mismatch gate regression.
//
// Verifies P0006 code → 409 invite_currency_mismatch envelope including the
// partner_gate payload parsed from the RPC EXCEPTION DETAIL. Pure-logic
// (no network) so it runs in CI.
//
// Run: deno test --allow-read \
//   supabase/functions/accept-brand-invitation/__tests__/orch-1052-currency-gate.test.ts

import {
  assertEquals,
} from "https://deno.land/std@0.190.0/testing/asserts.ts";
import { mapRpcError, parsePartnerGateDetail } from "../index.ts";

Deno.test("mapRpcError: P0006 → 409 invite_currency_mismatch", () => {
  assertEquals(mapRpcError("P0006"), {
    status: 409,
    error: "invite_currency_mismatch",
  });
});

Deno.test("mapRpcError: legacy ERRCODEs unchanged", () => {
  assertEquals(mapRpcError("P0001"), { status: 404, error: "invite_not_found" });
  assertEquals(mapRpcError("P0002"), { status: 410, error: "invite_already_used" });
  assertEquals(mapRpcError("P0003"), { status: 410, error: "invite_expired" });
  assertEquals(mapRpcError("P0004"), { status: 403, error: "invite_email_mismatch" });
  assertEquals(mapRpcError("P0005"), { status: 410, error: "invite_revoked" });
  assertEquals(mapRpcError("23505"), null);
});

Deno.test("parsePartnerGateDetail: parses currency_mismatch payload", () => {
  const detail = JSON.stringify({
    ok: false,
    reason: "currency_mismatch",
    brand_currency: "usd",
    partner_currencies: ["gbp"],
  });
  const parsed = parsePartnerGateDetail(detail);
  assertEquals(parsed, {
    ok: false,
    reason: "currency_mismatch",
    brand_currency: "usd",
    partner_currencies: ["gbp"],
  });
});

Deno.test("parsePartnerGateDetail: parses partner_stripe_not_connected payload", () => {
  const detail = JSON.stringify({
    ok: false,
    reason: "partner_stripe_not_connected",
    required_currency: "eur",
  });
  const parsed = parsePartnerGateDetail(detail);
  assertEquals(parsed, {
    ok: false,
    reason: "partner_stripe_not_connected",
    required_currency: "eur",
  });
});

Deno.test("parsePartnerGateDetail: returns null on missing / non-JSON / non-object", () => {
  assertEquals(parsePartnerGateDetail(undefined), null);
  assertEquals(parsePartnerGateDetail(""), null);
  assertEquals(parsePartnerGateDetail("not-json"), null);
  assertEquals(parsePartnerGateDetail("42"), null);
  assertEquals(parsePartnerGateDetail("null"), null);
});
