import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
const create = await Deno.readTextFile(
  new URL("../../venue-reservation-create/index.ts", import.meta.url),
);
const confirm = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);
Deno.test("guest cancellation authority is stored only as v1 hash", () => {
  assertStringIncludes(create, "guest_cancel_token_hash");
  assertStringIncludes(create, "`v1:${await sha256Hex(s.guestCancelToken)}`");
  assertStringIncludes(confirm, "buyer_status_token_hash");
  assertStringIncludes(confirm, "? buyerStatusToken");
});
