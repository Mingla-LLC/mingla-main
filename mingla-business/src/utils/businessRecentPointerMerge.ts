import type {
  BusinessRecentEntityType,
  BusinessRecentPointer,
} from "../store/businessRecentStore";

const pointerKey = (pointer: BusinessRecentPointer): string =>
  `${pointer.entityType}:${pointer.entityId}`;

export const mergeRecentPointers = (
  current: BusinessRecentPointer[],
  incoming: BusinessRecentPointer[],
): BusinessRecentPointer[] => {
  const byKey = new Map<string, BusinessRecentPointer>();
  for (const pointer of [...current, ...incoming]) {
    const key = pointerKey(pointer);
    const prior = byKey.get(key);
    if (
      prior === undefined ||
      Date.parse(pointer.lastOpenedAt) >= Date.parse(prior.lastOpenedAt)
    ) {
      byKey.set(key, { ...prior, ...pointer });
    }
  }
  return Array.from(byKey.values())
    .sort((a, b) => {
      const time = Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt);
      return time !== 0 ? time : pointerKey(b).localeCompare(pointerKey(a));
    })
    .slice(0, 200);
};

export const promoteBusinessRecentPointers = (
  current: BusinessRecentPointer[],
  input: {
    entityType: BusinessRecentEntityType;
    localId: string;
    serverId: string;
    operationId: string;
  },
): BusinessRecentPointer[] => {
  const local = current.find(
    (pointer) =>
      pointer.entityType === input.entityType &&
      pointer.entityId === input.localId,
  );
  if (local === undefined) return current;
  const server = current.find(
    (pointer) =>
      pointer.entityType === input.entityType &&
      pointer.entityId === input.serverId,
  );
  const newer =
    server !== undefined &&
    Date.parse(server.lastOpenedAt) > Date.parse(local.lastOpenedAt)
      ? server
      : local;
  return mergeRecentPointers(
    current.filter(
      (pointer) =>
        pointer.entityType !== input.entityType ||
        (pointer.entityId !== input.localId &&
          pointer.entityId !== input.serverId),
    ),
    [
      {
        ...local,
        ...server,
        ...newer,
        entityId: input.serverId,
        operationId: input.operationId,
        pendingSync: true,
        localDraft: false,
      },
    ],
  );
};
