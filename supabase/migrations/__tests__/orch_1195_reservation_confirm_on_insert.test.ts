// ORCH-1195 FIX 3 — the reservation notify trigger must fire on INSERT too, so a
// born-confirmed fee/table reservation enqueues a buyer_reservation_confirmed
// email (previously 0 ever produced: the UPDATE-only trigger never saw a
// requested→confirmed transition). Source-contract test (fails-on-revert).
import { assert } from "jsr:@std/assert@1";

const MIG =
  "supabase/migrations/20261119000000_orch_1195_reservation_confirm_email_on_insert.sql";
const sql = await Deno.readTextFile(MIG);
const has = (n: string, why: string) =>
  assert(sql.includes(n), `must contain \`${n}\` (${why})`);

Deno.test("FIX3 — trigger fires AFTER INSERT OR UPDATE", () => {
  has("AFTER INSERT OR UPDATE ON public.reservations", "INSERT-born-confirmed path");
});

Deno.test("FIX3 — INSERT path enqueues buyer_reservation_confirmed when born confirmed", () => {
  has("IF TG_OP = 'INSERT' THEN", "INSERT branch");
  has("NEW.status = 'confirmed'", "only when confirmed");
  has("'buyer_reservation_confirmed'", "the confirmed category");
  has("INSERT INTO public.notification_outbox", "enqueue the email");
});

Deno.test("FIX3 — stable idem key dedups INSERT vs later requested→confirmed UPDATE", () => {
  has("'buyer_reservation_confirmed:' || NEW.id::text", "stable per-reservation key");
  has("ON CONFLICT (idempotency_key) DO NOTHING", "dedup");
});

Deno.test("FIX3 — UPDATE path preserved (changed/cancelled still mapped)", () => {
  has("buyer_reservation_changed", "UPDATE transitions preserved");
  has("buyer_reservation_cancelled", "cancel transitions preserved");
});
