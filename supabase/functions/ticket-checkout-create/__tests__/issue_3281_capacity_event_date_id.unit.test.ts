/**
 * issue #3281 PR10 — behavioral pins for capacityEventDateIdFromError.
 * [TEST-MOD-APPROVED #3281]
 */
import {
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { capacityEventDateIdFromError } from "../capacityEventDateId.ts";

const UUID = "a1b2c3d4-e5f6-4789-a012-3456789abcde";
const UUID_UPPER = "A1B2C3D4-E5F6-4789-A012-3456789ABCDE";

Deno.test("null / undefined / empty → null", () => {
  assertEquals(capacityEventDateIdFromError(null), null);
  assertEquals(capacityEventDateIdFromError(undefined), null);
  assertEquals(capacityEventDateIdFromError({}), null);
  assertEquals(capacityEventDateIdFromError({ details: 1, detail: true }), null);
});

Deno.test("bare uuid on details / detail / message", () => {
  assertEquals(
    capacityEventDateIdFromError({ details: UUID }),
    UUID,
  );
  assertEquals(
    capacityEventDateIdFromError({ detail: UUID }),
    UUID,
  );
  assertEquals(
    capacityEventDateIdFromError({ message: UUID }),
    UUID,
  );
});

Deno.test("uuid embedded in longer PostgREST DETAIL string", () => {
  assertEquals(
    capacityEventDateIdFromError({
      details: `Key (event_date_id)=(${UUID}) already sold out`,
    }),
    UUID,
  );
  assertEquals(
    capacityEventDateIdFromError({
      detail: `ticket_capacity_exceeded\nDETAIL: ${UUID}`,
    }),
    UUID,
  );
});

Deno.test("details preferred over detail/message; lowercases", () => {
  assertEquals(
    capacityEventDateIdFromError({
      details: UUID_UPPER,
      detail: "00000000-0000-4000-8000-000000000000",
      message: "11111111-1111-4111-8111-111111111111",
    }),
    UUID,
  );
});

Deno.test("non-uuid strings stay null", () => {
  assertEquals(
    capacityEventDateIdFromError({ details: "ticket_capacity_exceeded" }),
    null,
  );
  assertEquals(
    capacityEventDateIdFromError({ detail: "not-a-uuid" }),
    null,
  );
});
