import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const rpc = jest.fn<(...args: unknown[]) => Promise<{ data: any; error: any }>>();
jest.mock("../supabase", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));
jest.mock("../../diagnostics/reportNonFatal", () => ({
  reportNonFatal: jest.fn(),
}));

import {
  getBrandPerson,
  getBrandPersonMaintenanceOperation,
  listBrandPersonMergeCandidates,
  listBrandPersonMergeHistory,
  mergeBrandPeople,
  PeopleServiceError,
  previewBrandPersonMerge,
  previewBrandPersonSplit,
  promoteBrandPersonContact,
  splitBrandPersonMerge,
} from "../peopleService";

const identity = {
  personId: "17720000-0000-4000-8000-000000000001",
  displayName: "Maya Thompson",
  avatarUrl: null,
  updatedAt: "2026-08-30T12:00:00.000Z",
  alternateNames: ["Maya T."],
  contacts: [{
    id: "17720000-0000-4000-8000-000000000002",
    channel: "email",
    value: "maya@example.test",
    isPrimary: true,
  }],
  linked: true,
  identityVersion: "version-left",
};
const other = {
  ...identity,
  personId: "17720000-0000-4000-8000-000000000003",
  displayName: "Maya T",
  linked: false,
  identityVersion: "version-right",
};
const detail = {
  ...identity,
  suppressions: [],
  capabilities: {
    canMerge: true,
    canPromotePrimary: true,
    canViewMergeHistory: true,
    canSplit: true,
  },
};
const requestId = "17720000-0000-4000-8000-000000000010";
const mergeEventId = "17720000-0000-4000-8000-000000000011";

beforeEach(() => {
  rpc.mockReset();
});

describe("#1772 strict Business maintenance RPC boundary", () => {
  test("parses the extended detail and candidate/preview read contracts", async () => {
    rpc.mockResolvedValueOnce({ data: detail, error: null });
    await expect(getBrandPerson({
      brandId: "brand-1",
      personId: identity.personId,
    })).resolves.toEqual(detail);

    rpc.mockResolvedValueOnce({
      data: {
        rows: [other],
        nextCursor: { updatedAt: other.updatedAt, personId: other.personId },
      },
      error: null,
    });
    await expect(listBrandPersonMergeCandidates({
      brandId: "brand-1",
      personId: identity.personId,
      search: "maya",
      cursor: null,
      limit: 50,
    })).resolves.toEqual({
      rows: [other],
      nextCursor: { updatedAt: other.updatedAt, personId: other.personId },
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "biz_list_brand_person_merge_candidates",
      {
        p_brand_id: "brand-1",
        p_person_id: identity.personId,
        p_search: "maya",
        p_cursor: null,
        p_limit: 50,
      },
    );

    const preview = {
      state: "ready",
      left: identity,
      right: other,
      leftVersion: identity.identityVersion,
      rightVersion: other.identityVersion,
      hadOpenConflict: false,
      hadPriorSeparation: true,
    };
    rpc.mockResolvedValueOnce({ data: preview, error: null });
    await expect(previewBrandPersonMerge({
      brandId: "brand-1",
      leftPersonId: identity.personId,
      rightPersonId: other.personId,
    })).resolves.toEqual(preview);
  });

  test("uses only the manual wrapper RPCs and preserves one supplied request id", async () => {
    const merged = {
      operationId: requestId,
      mergeEventId,
      survivorPersonId: identity.personId,
      absorbedPersonId: other.personId,
      identityVersion: "version-merged",
      replayed: false,
    };
    rpc.mockResolvedValueOnce({ data: merged, error: null });
    await expect(mergeBrandPeople({
      brandId: "brand-1",
      winnerPersonId: identity.personId,
      loserPersonId: other.personId,
      winnerVersion: identity.identityVersion,
      loserVersion: other.identityVersion,
      clientRequestId: requestId,
    })).resolves.toEqual(merged);
    expect(rpc).toHaveBeenLastCalledWith("biz_merge_brand_people_manual", {
      p_brand_id: "brand-1",
      p_winner_person_id: identity.personId,
      p_loser_person_id: other.personId,
      p_winner_version: identity.identityVersion,
      p_loser_version: other.identityVersion,
      p_client_request_id: requestId,
    });

    const promoted = {
      operationId: requestId,
      outcome: "completed",
      personId: identity.personId,
      contactMethodId: identity.contacts[0].id,
      channel: "email",
      identityVersion: "version-promoted",
      replayed: false,
    };
    rpc.mockResolvedValueOnce({ data: promoted, error: null });
    await expect(promoteBrandPersonContact({
      brandId: "brand-1",
      personId: identity.personId,
      contactMethodId: identity.contacts[0].id,
      personVersion: identity.identityVersion,
      clientRequestId: requestId,
    })).resolves.toEqual(promoted);
    expect(rpc).toHaveBeenLastCalledWith(
      "biz_promote_brand_person_contact",
      expect.objectContaining({ p_client_request_id: requestId }),
    );
  });

  test("parses history, exact safe Split partitions, Split result, and recovery receipt", async () => {
    const historyRow = {
      mergeEventId,
      status: "active",
      createdAt: "2026-08-30T12:00:00.000Z",
      reversedAt: null,
      survivorPersonId: identity.personId,
      survivorLabel: identity.displayName,
      counterpartPersonId: other.personId,
      counterpartLabel: other.displayName,
      canSplit: true,
      eventVersion: "event-version",
    };
    rpc.mockResolvedValueOnce({
      data: { rows: [historyRow], nextCursor: null },
      error: null,
    });
    await expect(listBrandPersonMergeHistory({
      brandId: "brand-1",
      personId: identity.personId,
      cursor: null,
      limit: 20,
    })).resolves.toEqual({ rows: [historyRow], nextCursor: null });

    const splitPreview = {
      state: "safe",
      mergeEventId,
      splitVersion: "event-version",
      left: identity,
      right: other,
    };
    rpc.mockResolvedValueOnce({ data: splitPreview, error: null });
    await expect(previewBrandPersonSplit({
      brandId: "brand-1",
      mergeEventId,
    })).resolves.toEqual(splitPreview);

    const splitResult = {
      operationId: requestId,
      outcome: "reversed",
      restoredPersonId: other.personId,
      replayed: false,
    };
    rpc.mockResolvedValueOnce({ data: splitResult, error: null });
    await expect(splitBrandPersonMerge({
      brandId: "brand-1",
      mergeEventId,
      splitVersion: "event-version",
      clientRequestId: requestId,
    })).resolves.toEqual(splitResult);

    rpc.mockResolvedValueOnce({
      data: { ...splitResult, replayed: true },
      error: null,
    });
    await expect(getBrandPersonMaintenanceOperation({
      brandId: "brand-1",
      clientRequestId: requestId,
    })).resolves.toEqual({ ...splitResult, replayed: true });
  });

  test("fails closed on partial new DTOs and maps operation-specific safe errors", async () => {
    rpc.mockResolvedValueOnce({
      data: { ...detail, identityVersion: undefined },
      error: null,
    });
    await expect(getBrandPerson({
      brandId: "brand-1",
      personId: identity.personId,
    })).rejects.toMatchObject({ code: "people_unknown", retryable: false });

    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "people_identity_stale: raw database detail" },
    });
    await expect(mergeBrandPeople({
      brandId: "brand-1",
      winnerPersonId: identity.personId,
      loserPersonId: other.personId,
      winnerVersion: "old",
      loserVersion: "old",
      clientRequestId: requestId,
    })).rejects.toEqual(expect.objectContaining({
      code: "people_merge_stale",
      retryable: false,
    }));

    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "provider said customer@example.test" },
    });
    const rejection = previewBrandPersonSplit({
      brandId: "brand-1",
      mergeEventId,
    });
    await expect(rejection).rejects.toBeInstanceOf(PeopleServiceError);
    await expect(rejection).rejects.toMatchObject({
      code: "people_temporarily_unavailable",
      retryable: true,
    });
  });
});
