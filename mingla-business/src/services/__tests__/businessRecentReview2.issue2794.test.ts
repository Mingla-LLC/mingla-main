/* eslint-disable import/first -- Secure-random boundary must be mocked before the service import. */
jest.mock("../../lib/secureRandomSafe", () => ({
  ensureSecureRandom: jest.fn(() => false),
}));

import {
  canonicalBusinessRecentLifecycle,
  newRecentOperationId,
  recentErrorCategory,
  retainAuthoritativeBusinessRecentPointers,
} from "../businessRecentService";
import {
  businessRecentDestination,
  routeForBusinessRecent,
} from "../../utils/routeForEventRow";
import {
  recentScopeKey,
  useBusinessRecentStore,
  type BusinessRecentPointer,
} from "../../store/businessRecentStore";
import { clearAllStores } from "../../utils/clearAllStores";

const pointer = (
  entityId: string,
  overrides: Partial<BusinessRecentPointer> = {},
): BusinessRecentPointer => ({
  entityType: "event",
  entityId,
  lastOpenedAt: "2026-08-29T12:00:00.000Z",
  operationId: `op-${entityId}`,
  pendingSync: false,
  localDraft: false,
  ...overrides,
});

test("routes from raw destination truth and never rejects canonical display statuses", () => {
  for (const status of ["verified", "upcoming", "past", "cancelled"]) {
    expect(
      routeForBusinessRecent({
        id: "entity",
        entityType: status === "verified" ? "venue" : "event",
        destination: "detail",
        status,
      }),
    ).toBe(status === "verified" ? "/venue/entity" : "/event/entity");
  }
  expect(businessRecentDestination("event", "draft")).toBe("edit");
  expect(
    routeForBusinessRecent({
      id: "draft-event",
      entityType: "event",
      destination: "edit",
      status: "upcoming",
    }),
  ).toBe("/event/draft-event/edit");
  expect(businessRecentDestination("experience", "draft")).toBe("detail");
  expect(
    routeForBusinessRecent({
      id: "draft-experience",
      entityType: "experience",
      destination: "edit",
      status: "draft",
    }),
  ).toBe("/experience/draft-experience");
});

test("lifecycle is byte-aligned with Home: events and experiences derive, trips persist", () => {
  const now = jest.spyOn(Date, "now").mockReturnValue(
    Date.parse("2026-08-29T12:00:00.000Z"),
  );
  const base = {
    pointerId: "pointer",
    entityId: "entity",
    lastOpenedAt: "2026-08-29T12:00:00.000Z",
    rawStatus: "scheduled",
    startsAt: "2026-08-29T13:00:00.000Z",
    endsAt: "2026-08-30T13:00:00.000Z",
    endedAt: null,
  };
  expect(
    canonicalBusinessRecentLifecycle({ ...base, entityType: "event" }),
  ).toBe("live");
  expect(
    canonicalBusinessRecentLifecycle({ ...base, entityType: "experience" }),
  ).toBe("live");
  expect(
    canonicalBusinessRecentLifecycle({ ...base, entityType: "trip" }),
  ).toBe("scheduled");
  now.mockRestore();
});

test("authoritative index evicts settled stale identities but preserves real pending and local drafts", () => {
  const rows = retainAuthoritativeBusinessRecentPointers(
    [
      pointer("kept"),
      pointer("revoked"),
      pointer("pending", { pendingSync: true }),
      pointer("d_local", { localDraft: true }),
    ],
    [
      {
        pointerId: "p-kept",
        entityType: "event",
        entityId: "kept",
        lastOpenedAt: "2026-08-29T12:00:00.000Z",
        lifecycleStatus: "upcoming",
        rawStatus: "scheduled",
        startsAt: null,
        endsAt: null,
        endedAt: null,
      },
    ],
  );
  expect(rows.map((row) => row.entityId)).toEqual([
    "kept",
    "pending",
    "d_local",
  ]);
});

test("entity permission is target-scoped and operation fallback never calls Math.random", () => {
  expect(recentErrorCategory(new Error("recent_entity_forbidden"))).toBe(
    "entity-permission",
  );
  expect(recentErrorCategory(new Error("recent_brand_forbidden"))).toBe(
    "permission",
  );
  const originalCrypto = globalThis.crypto;
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: undefined,
  });
  const weakRandom = jest.spyOn(Math, "random");
  expect(newRecentOperationId()).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(weakRandom).not.toHaveBeenCalled();
  weakRandom.mockRestore();
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: originalCrypto,
  });
});

test("central clearAllStores is the executable Recent Zustand reset authority", () => {
  const scope = recentScopeKey("user", "brand");
  useBusinessRecentStore.getState().upsert(scope, pointer("private"));
  const generation = useBusinessRecentStore.getState().generation;
  clearAllStores();
  expect(useBusinessRecentStore.getState().scopes).toEqual({});
  expect(useBusinessRecentStore.getState().generation).toBe(generation + 1);
});
