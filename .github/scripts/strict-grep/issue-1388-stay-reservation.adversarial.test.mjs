import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const schema = read(
  "supabase/migrations/20270131013810_issue_1388_stay_reservation_schema.sql",
);
const management = read(
  "supabase/migrations/20270131013811_issue_1388_stay_reservation_management.sql",
);
const edge = read("supabase/functions/stay-reservations/index.ts");
const service = read("mingla-business/src/services/stayReservationService.ts");

function functionBody(functionName) {
  const start = management.indexOf(`FUNCTION public.${functionName}(`);
  assert.ok(start >= 0, `${functionName} must exist`);
  const end = management.indexOf("\n$function$;", start);
  assert.ok(end > start, `${functionName} must have a bounded body`);
  return management.slice(start, end);
}

test("group creation locks shared resources before inventory in a stable order", () => {
  const body = functionBody("issue_1388_create_stay_group");
  const brandLock = body.indexOf("PERFORM 1 FROM public.brands");
  const settingsLock = body.indexOf("SELECT * INTO v_settings", brandLock);
  const offeringLock = body.indexOf("FOR UPDATE OF offering");
  const roomNightLock = body.indexOf("FOR UPDATE OF night");
  const windowLock = body.indexOf("FOR UPDATE OF window_row");
  const unitLock = body.indexOf("FOR UPDATE OF unit_row");
  const holdLock = body.indexOf("FOR UPDATE OF slice_row, hold_row");
  assert.ok(
    brandLock >= 0 &&
      settingsLock > brandLock &&
      offeringLock > settingsLock &&
      roomNightLock > offeringLock &&
      windowLock > roomNightLock &&
      unitLock > windowLock &&
      holdLock > unitLock,
  );
  assert.match(body, /ORDER BY offering\.id/);
  assert.match(body, /ORDER BY night\.offering_id, night\.local_date/);
});

test("quote mode comes from offering truth and Request approval never charges", () => {
  const quote = functionBody("issue_1388_quote_stay_cart");
  const manage = functionBody("issue_1388_manage_request");
  assert.match(
    quote,
    /v_offering\.confirmation_mode = 'request'[\s\S]*v_mode := 'request'/,
  );
  assert.doesNotMatch(
    manage,
    /\b(?:stripe|paystack|flutterwave|payment_intent|payment_method|precharge|charge_customer)\b/i,
  );
  assert.match(manage, /state = 'approved_payment_required'/);
  assert.match(manage, /expires_at = v_payment_deadline/);
});

test("money, snapshots, idempotency, and future commitments are database facts", () => {
  assert.match(schema, /\bsource_subtotal_minor bigint NOT NULL\b/);
  assert.match(schema, /\btotal_minor bigint NOT NULL\b/);
  assert.match(schema, /\bprice_snapshot jsonb NOT NULL\b/);
  assert.match(schema, /\bpolicy_snapshot jsonb NOT NULL\b/);
  assert.match(schema, /UNIQUE \(actor_key_hash, idempotency_key\)/);
  assert.match(schema, /CREATE TABLE public\.stay_inventory_commitments\b/);
  assert.match(management, /extensions\.digest/);
});

test("reservation internals are forced-RLS and direct-client dark", () => {
  assert.match(schema, /ENABLE ROW LEVEL SECURITY/);
  assert.match(schema, /FORCE ROW LEVEL SECURITY/);
  assert.match(
    schema,
    /REVOKE ALL ON public\.%I FROM public, anon, authenticated/,
  );
  assert.match(
    management,
    /REVOKE ALL ON FUNCTION public\.biz_manage_stay_reservation[\s\S]*FROM public, anon/,
  );
  assert.match(
    management,
    /GRANT EXECUTE ON FUNCTION public\.biz_manage_stay_reservation[\s\S]*TO authenticated, service_role/,
  );
});

test("edge and business client expose only the bounded #1388 action set", () => {
  for (const action of [
    "quote",
    "create_group",
    "approve_request",
    "decline_request",
    "get_group",
  ]) {
    assert.match(edge, new RegExp(`"${action}"`));
    assert.match(service, new RegExp(`"${action}"`));
  }
  assert.doesNotMatch(edge, /\bcreate_payment\b|\bconfirm_payment\b/);
  assert.match(edge, /MAX_REQUEST_BYTES = 262_144/);
  assert.match(edge, /biz_manage_stay_reservation/);
  assert.match(service, /"stay-reservations"/);
});
