import { mergeRecentPointers, recentScopeKey } from "../businessRecentStore";

const pointer = (id: string, opened: number) => ({
  entityType: "event" as const,
  entityId: id,
  lastOpenedAt: new Date(opened).toISOString(),
  operationId: `op-${id}`,
  pendingSync: false,
  localDraft: false,
});

test("#2794 cache is scoped, deduplicated, newest-first, and bounded", () => {
  expect(recentScopeKey("user-a", "brand-a")).not.toBe(
    recentScopeKey("user-a", "brand-b"),
  );
  const rows = mergeRecentPointers(
    Array.from({ length: 200 }, (_, index) => pointer(String(index), index)),
    [pointer("0", 999), pointer("new", 1000)],
  );
  expect(rows).toHaveLength(200);
  expect(rows[0]?.entityId).toBe("new");
  expect(rows.filter((row) => row.entityId === "0")).toHaveLength(1);
});
