import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
const create = await Deno.readTextFile(
  new URL("../../venue-reservation-create/index.ts", import.meta.url),
);
const confirm = await Deno.readTextFile(
  new URL("../index.ts", import.meta.url),
);
Deno.test("raw guest token is never persisted or read back", () => {
  assert(!create.includes("guest_cancel_token: s.guestCancelToken"));
  assert(!confirm.includes("session.guest_cancel_token"));
  assert(!confirm.includes("reservation.guest_cancel_token"));
});
