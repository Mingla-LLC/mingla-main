/* eslint-disable import/first -- Jest must install the canonical lifecycle mock before importing the service. */
jest.mock("../../components/trip/TripDetailHeroStatusPill", () => ({
  deriveTripLifecycleStatus: (input: { status: string }) => input.status,
}));

import {
  businessRecentKeys,
  orderBusinessRecentIndex,
  orderBusinessRecentPointers,
} from "../../services/businessRecentService";
import {
  mergeRecentPointers,
  promoteBusinessRecentPointers,
  recentScopeKey,
  useBusinessRecentStore,
} from "../../store/businessRecentStore";

const index = (
  id: string,
  opened: string,
  status = "scheduled",
  start: string | null = null,
) => ({
  pointerId: `p-${id}`,
  entityType: "event" as const,
  entityId: id,
  lastOpenedAt: opened,
  lifecycleStatus: status,
  rawStatus: status,
  startsAt: start,
  endsAt: null,
  endedAt: null,
});
const pointer = (id: string, opened: string) => ({
  entityType: "event" as const,
  entityId: id,
  lastOpenedAt: opened,
  operationId: `op-${id}`,
  pendingSync: false,
  localDraft: false,
});

beforeEach(() => useBusinessRecentStore.getState().reset());

test("live-first survives hydration and deterministic tie-breaking", () => {
  const rows = [
    index("newer", "2026-08-29T11:59:00Z"),
    index("live", "2026-08-28T00:00:00Z", "live", "2026-08-29T11:00:00Z"),
  ];
  expect(orderBusinessRecentIndex(rows)[0]?.entityId).toBe("live");
  expect(
    orderBusinessRecentPointers(
      rows.map((row) => pointer(row.entityId, row.lastOpenedAt)),
      rows,
    )[0]?.entityId,
  ).toBe("live");
});

test("keys separate index and every page, while cache remains 200 and scope-isolated", () => {
  expect(businessRecentKeys.index("u", "b")).toEqual([
    "business-recent-index",
    "u",
    "b",
  ]);
  expect(businessRecentKeys.page("u", "b", 2, "cursor-2")).toEqual([
    "business-recent-page",
    "u",
    "b",
    2,
    "cursor-2",
  ]);
  expect(businessRecentKeys.page("u", "b", 1, "cursor-1")).not.toEqual(
    businessRecentKeys.page("u", "b", 2, "cursor-2"),
  );
  expect(
    mergeRecentPointers(
      [],
      Array.from({ length: 201 }, (_, i) =>
        pointer(String(i), new Date(i).toISOString()),
      ),
    ),
  ).toHaveLength(200);
  expect(recentScopeKey("u1", "b1")).not.toBe(recentScopeKey("u2", "b1"));
});

test("draft promotion deduplicates aliases and reset invalidates late generations", () => {
  const store = useBusinessRecentStore.getState();
  const scope = recentScopeKey("u", "b");
  store.upsert(scope, {
    ...pointer("d_local", new Date().toISOString()),
    localDraft: true,
  });
  store.upsert(scope, pointer("server", new Date(0).toISOString()));
  const generation = useBusinessRecentStore.getState().generation;
  store.promoteDraft(scope, "event", "d_local", "server", "promoted-op");
  expect(useBusinessRecentStore.getState().scopes[scope]).toHaveLength(1);
  expect(useBusinessRecentStore.getState().scopes[scope]?.[0]).toMatchObject({
    entityId: "server",
    pendingSync: true,
    localDraft: false,
  });
  useBusinessRecentStore.getState().reset();
  expect(useBusinessRecentStore.getState().generation).toBe(generation + 1);
  expect(useBusinessRecentStore.getState().scopes).toEqual({});
});

test("Zustand keeps only client pointer and queue truth", () => {
  const scope = recentScopeKey("u", "b");
  const presentation = {
    ...pointer("event", "2026-08-29T12:00:00Z"),
    title: "Private title",
    coverUrl: "https://private.invalid/cover.jpg",
    status: "live",
  };
  useBusinessRecentStore.getState().upsert(scope, presentation);
  expect(useBusinessRecentStore.getState().scopes[scope]?.[0]).toEqual(
    pointer("event", "2026-08-29T12:00:00Z"),
  );
});

test("presentation promotion collapses aliases and preserves the later truthful open", () => {
  const promoted = promoteBusinessRecentPointers(
    [
      {
        ...pointer("d_local", "2026-08-29T12:00:00Z"),
        title: "Local title",
        localDraft: true,
      },
      {
        ...pointer("server", "2026-08-29T13:00:00Z"),
        title: "Server title",
      },
    ],
    {
      entityType: "event",
      localId: "d_local",
      serverId: "server",
      operationId: "promoted-op",
    },
  );
  expect(promoted).toHaveLength(1);
  expect(promoted[0]).toMatchObject({
    entityId: "server",
    lastOpenedAt: "2026-08-29T13:00:00Z",
    title: "Server title",
    operationId: "promoted-op",
    pendingSync: true,
    localDraft: false,
  });
});
