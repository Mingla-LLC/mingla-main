import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";

let auth = { isAuthReady: true, user: { id: "supporting-user" } as { id: string } | null };
const candidatesMock = jest.fn<(...args: any[]) => Promise<any>>();
const previewMock = jest.fn<(...args: any[]) => Promise<any>>();
const historyMock = jest.fn<(...args: any[]) => Promise<any>>();
const splitPreviewMock = jest.fn<(...args: any[]) => Promise<any>>();
const mergeMock = jest.fn<(...args: any[]) => Promise<any>>();
const promoteMock = jest.fn<(...args: any[]) => Promise<any>>();
const splitMock = jest.fn<(...args: any[]) => Promise<any>>();
const operationMock = jest.fn<(...args: any[]) => Promise<any>>();

jest.mock("../../../context/AuthContext", () => ({ useAuth: () => auth }));
jest.mock("../../../services/peopleService", () => {
  class MockPeopleServiceError extends Error {
    constructor(public code: string, public retryable: boolean) {
      super(code);
    }
  }
  return {
    PeopleServiceError: MockPeopleServiceError,
  };
});
jest.mock("../../../services/peopleMaintenanceService", () => {
  return {
    listBrandPersonMergeCandidates: (...args: any[]) => candidatesMock(...args),
    previewBrandPersonMerge: (...args: any[]) => previewMock(...args),
    listBrandPersonMergeHistory: (...args: any[]) => historyMock(...args),
    previewBrandPersonSplit: (...args: any[]) => splitPreviewMock(...args),
    mergeBrandPeople: (...args: any[]) => mergeMock(...args),
    promoteBrandPersonContact: (...args: any[]) => promoteMock(...args),
    splitBrandPersonMerge: (...args: any[]) => splitMock(...args),
    getBrandPersonMaintenanceOperation: (...args: any[]) => operationMock(...args),
  };
});

import { PeopleServiceError } from "../../../services/peopleService";
import {
  parsePersistedMaintenanceIntents,
  stableMaintenanceRequestId,
  useBrandPersonMaintenance,
  type UseBrandPersonMaintenanceInput,
} from "../useBrandPersonMaintenance";
import { marketingKeys } from "../marketingKeys";

const TR = require("react-test-renderer") as {
  create: (node: React.ReactElement) => { unmount: () => void };
  act: (callback: () => void | Promise<void>) => void | Promise<void>;
};

const base: UseBrandPersonMaintenanceInput = {
  brandId: "brand-a",
  personId: "person-a",
  roleResolved: true,
  accepted: true,
  rank: 50,
  online: true,
  candidateSearch: "",
  pickerOpen: false,
  mergeReviewOpen: false,
  selectedPersonId: null,
  historyEnabled: false,
  splitOpen: false,
  splitMergeEventId: null,
};
let latest: ReturnType<typeof useBrandPersonMaintenance>;
let client: QueryClient;
let tree: { unmount: () => void } | null = null;

function Probe({ input }: { input: UseBrandPersonMaintenanceInput }) {
  latest = useBrandPersonMaintenance(input);
  return null;
}

function mount(input: UseBrandPersonMaintenanceInput) {
  TR.act(() => {
    tree = TR.create(
      <QueryClientProvider client={client}>
        <Probe input={input} />
      </QueryClientProvider>,
    );
  });
}

async function flush() {
  await TR.act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });
}

beforeEach(async () => {
  auth = { isAuthReady: true, user: { id: "supporting-user" } };
  for (const mock of [
    candidatesMock,
    previewMock,
    historyMock,
    splitPreviewMock,
    mergeMock,
    promoteMock,
    splitMock,
    operationMock,
  ]) mock.mockReset();
  candidatesMock.mockResolvedValue({ rows: [], nextCursor: null });
  historyMock.mockResolvedValue({ rows: [], nextCursor: null });
  await AsyncStorage.clear();
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
});

afterEach(() => {
  if (tree) TR.act(() => tree?.unmount());
  tree = null;
  client.clear();
});

describe("#1772 maintenance hook authority and recovery", () => {
  test("one submitted intent keeps one stable UUID", () => {
    const requests = new Map<string, string>();
    const first = stableMaintenanceRequestId(requests, "merge:a:b");
    const retry = stableMaintenanceRequestId(requests, "merge:a:b");
    const different = stableMaintenanceRequestId(requests, "merge:b:a");
    expect(first).toMatch(/^[0-9a-f-]{36}$/i);
    expect(retry).toBe(first);
    expect(different).not.toBe(first);
  });

  test("rank 20 reads history but never starts rank-50 candidate/preflight queries", async () => {
    mount({
      ...base,
      rank: 20,
      pickerOpen: true,
      mergeReviewOpen: true,
      selectedPersonId: "person-b",
      historyEnabled: true,
    });
    await flush();
    expect(historyMock).toHaveBeenCalledWith(expect.objectContaining({
      brandId: "brand-a",
      personId: "person-a",
    }));
    expect(candidatesMock).not.toHaveBeenCalled();
    expect(previewMock).not.toHaveBeenCalled();
    expect(latest.canRead).toBe(true);
    expect(latest.canMerge).toBe(false);
  });

  test("open rank-50 flows fetch only their matching preflights", async () => {
    const preview = { state: "ready", left: {}, right: {} };
    const splitPreview = { state: "unsafe", supportReference: "BP-ABC123" };
    previewMock.mockResolvedValue(preview);
    splitPreviewMock.mockResolvedValue(splitPreview);
    mount({
      ...base,
      pickerOpen: true,
      mergeReviewOpen: true,
      selectedPersonId: "person-b",
      splitOpen: true,
      splitMergeEventId: "merge-event-a",
    });
    await flush();
    expect(candidatesMock).toHaveBeenCalledTimes(1);
    expect(previewMock).toHaveBeenCalledTimes(1);
    expect(splitPreviewMock).toHaveBeenCalledTimes(1);
  });

  test("a timeout resolves the stored receipt with the same request id and invalidates every People consumer", async () => {
    const result = {
      operationId: "request-a",
      mergeEventId: "merge-a",
      survivorPersonId: "person-a",
      absorbedPersonId: "person-b",
      identityVersion: "version-new",
      replayed: true,
    };
    mergeMock.mockRejectedValue(
      new PeopleServiceError("people_temporarily_unavailable", true),
    );
    operationMock.mockResolvedValue(result);
    const invalidate = jest.spyOn(client, "invalidateQueries");
    mount(base);
    await flush();
    let resolved: unknown;
    await TR.act(async () => {
      resolved = await latest.merge.mutateAsync({
        intentKey: "person-a:person-b:version-a:version-b",
        winnerPersonId: "person-a",
        loserPersonId: "person-b",
        winnerVersion: "version-a",
        loserVersion: "version-b",
      });
    });
    expect(resolved).toEqual(result);
    expect(latest.recoveryState).toBe("receipt");
    expect(latest.recoveredOperation).toEqual(result);
    const submittedId = mergeMock.mock.calls[0][0].clientRequestId;
    const storage = await AsyncStorage.getItem(
      "mingla:brand-person-maintenance:v1:supporting-user:brand-a",
    );
    expect(storage).toContain(`\"clientRequestId\":\"${submittedId}\"`);
    expect((AsyncStorage.setItem as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
      mergeMock.mock.invocationCallOrder[0],
    );
    expect(operationMock).toHaveBeenCalledWith({
      brandId: "brand-a",
      clientRequestId: submittedId,
    });
    // [TEST-MOD-APPROVED #1772] Receipt acknowledgement, not mutation return,
    // owns the active refetch so an absorbed detail is never fetched mid-flow.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: marketingKeys.people.all("brand-a"),
      refetchType: "none",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: marketingKeys.audiences.book("brand-a"),
      refetchType: "none",
    });
  });

  test("offline mutations fail before any RPC", async () => {
    mount({ ...base, online: false });
    await flush();
    await expect(latest.promote.mutateAsync({
      intentKey: "contact-a:version-a",
      personId: "person-a",
      contactMethodId: "contact-a",
      personVersion: "version-a",
    })).rejects.toMatchObject({
      code: "people_temporarily_unavailable",
      retryable: true,
    });
    expect(promoteMock).not.toHaveBeenCalled();
  });

  test("remount checks a durable request before enabling resend and restores its receipt", async () => {
    const result = {
      operationId: "17720000-0000-4000-8000-000000000010",
      mergeEventId: "17720000-0000-4000-8000-000000000011",
      survivorPersonId: "person-b",
      absorbedPersonId: "person-a",
      identityVersion: "version-new",
      replayed: true,
    };
    await AsyncStorage.setItem(
      "mingla:brand-person-maintenance:v1:supporting-user:brand-a",
      JSON.stringify([{
        version: 1,
        actorId: "supporting-user",
        brandId: "brand-a",
        operationKind: "merge",
        intentKey: "merge:person-a:person-b:version-a:version-b",
        clientRequestId: "17720000-0000-4000-8000-000000000010",
        createdAt: Date.now(),
      }]),
    );
    operationMock.mockResolvedValue(result);
    mount(base);
    expect(latest.mutationAllowed).toBe(false);
    await flush();
    expect(operationMock).toHaveBeenCalledTimes(1);
    expect(latest.recoveryState).toBe("receipt");
    expect(latest.recoveredOperationKind).toBe("merge");
    expect(latest.recoveredOperation).toEqual(result);
    expect(latest.mutationAllowed).toBe(false);
    expect(mergeMock).not.toHaveBeenCalled();
  });

  test("storage failure blocks submit before the maintenance RPC", async () => {
    mount(base);
    await flush();
    jest.spyOn(AsyncStorage, "setItem").mockRejectedValueOnce(new Error("disk full"));
    await expect(latest.promote.mutateAsync({
      intentKey: "contact-a:version-a",
      personId: "person-a",
      contactMethodId: "contact-a",
      personVersion: "version-a",
    })).rejects.toMatchObject({
      code: "people_temporarily_unavailable",
      retryable: true,
    });
    await flush();
    expect(latest.recoveryState).toBe("storage_blocked");
    expect(promoteMock).not.toHaveBeenCalled();
  });

  test("recovery parser rejects foreign, expired, malformed, and PII-shaped records", () => {
    const now = Date.now();
    const valid = {
      version: 1,
      actorId: "supporting-user",
      brandId: "brand-a",
      operationKind: "split",
      intentKey: "split:merge-a:version-a",
      clientRequestId: "17720000-0000-4000-8000-000000000010",
      createdAt: now,
    };
    const parsed = parsePersistedMaintenanceIntents(JSON.stringify([
      valid,
      { ...valid, actorId: "another-user" },
      { ...valid, intentKey: "expired", createdAt: now - (24 * 60 * 60 * 1000) },
      { ...valid, intentKey: "pii", email: "private@example.test" },
    ]), "supporting-user", "brand-a", now);
    expect(parsed).toEqual({ entries: [valid], dirty: true });
  });
});
