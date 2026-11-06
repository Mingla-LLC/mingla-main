// Issue #4275 T-E3 — a persisted query never comes back with a fake `{}` error.
//
// JSON.stringify(new Error("x")) is `{}`. Persisted, that restored on the next
// launch as `error: {}` with good data beside it, which YourCircleSection reported
// to Sentry as "Object captured as exception with keys: [object has no keys]".
//
// FAILS-ON-REVERT: remove the error line from shouldDehydrateMinglaQuery and the
// first test fails; remove the state rewrite from serializePersistedQuery and the
// second fails.

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { shouldDehydrateMinglaQuery } from "../queryPersistence.ts";
import { serializePersistedQuery } from "../queryPersistenceBudget.ts";

const userId = "11111111-1111-4111-8111-111111111111";

Deno.test("T-E3 a failed query with no data is not persisted", () => {
  const query = { queryKey: ["chat-list", userId], state: { status: "error", fetchStatus: "idle", data: undefined } };
  assertEquals(shouldDehydrateMinglaQuery(query, userId), false);
});

Deno.test("T-E3 a failed refresh with data restores as success with the data and no error", () => {
  const data = { people: [{ userId: "u1" }] };
  const raw = serializePersistedQuery({
    queryKey: ["circle", userId],
    state: {
      data,
      dataUpdatedAt: 123,
      status: "error",
      error: new Error("refresh failed"),
      fetchFailureReason: new Error("refresh failed"),
      fetchFailureCount: 2,
    } as never,
  });
  const restored = JSON.parse(raw).state;
  assertEquals(restored.status, "success");
  assertEquals(restored.error, null);
  assertEquals(restored.fetchFailureReason, null);
  assertEquals(restored.fetchFailureCount, 0);
  assertEquals(restored.data, data);
  assertEquals(restored.dataUpdatedAt, 123);
});

Deno.test("T-E3 a healthy query serializes as before", () => {
  const query = {
    queryKey: ["circle", userId],
    state: { data: { a: 1 }, dataUpdatedAt: 5, status: "success", error: null },
  };
  assertEquals(JSON.parse(serializePersistedQuery(query as never)), JSON.parse(JSON.stringify(query)));
  assertEquals(shouldDehydrateMinglaQuery({ queryKey: ["circle", userId], state: { status: "success", fetchStatus: "idle", data: {} } }, userId), true);
});
