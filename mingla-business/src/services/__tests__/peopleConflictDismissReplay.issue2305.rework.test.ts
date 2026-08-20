/**
 * #2305 exact client contract for a durable Dismiss replay.
 *
 * A dismissed conflict intentionally has no person and no source links. The RPC
 * must still return arrays (never null), and the real service parser must accept
 * that durable success. Asking for a different outcome remains a typed error.
 */
const rpcMock = jest.fn();

jest.mock("../supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpcMock(...args) },
}));

jest.mock("../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: jest.fn(),
}));

import {
  PeopleServiceError,
  resolveBrandPersonConflict,
} from "../peopleService";

const input = {
  brandId: "23059000-0000-4000-8000-000000000010",
  conflictIds: ["23059000-0000-4000-8000-000000000050"],
  resolution: "dismiss" as const,
  winnerPersonId: null,
  clientRequestId: "23059000-0000-4000-8000-0000000000b1",
};

describe("#2305 dismissed conflict replay client contract", () => {
  beforeEach(() => rpcMock.mockReset());

  test("accepts deterministic null person plus empty link/merge arrays", async () => {
    rpcMock.mockResolvedValueOnce({
      data: {
        conflictIds: input.conflictIds,
        resolution: "dismiss",
        personId: null,
        links: [],
        mergedPersonIds: [],
        replayed: true,
      },
      error: null,
    });

    await expect(resolveBrandPersonConflict(input)).resolves.toEqual({
      conflictIds: input.conflictIds,
      resolution: "dismiss",
      personId: null,
      links: [],
      mergedPersonIds: [],
      replayed: true,
    });
  });

  test("preserves a different-outcome replay as typed already-resolved", async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "people_conflict_already_resolved" },
    });

    await expect(
      resolveBrandPersonConflict({ ...input, resolution: "separate" }),
    ).rejects.toMatchObject<Partial<PeopleServiceError>>({
      code: "people_conflict_already_resolved",
      retryable: false,
    });
  });
});
