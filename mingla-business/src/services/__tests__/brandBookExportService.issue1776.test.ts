import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const invoke = jest.fn<(...args: any[]) => Promise<any>>();
jest.mock("../supabase", () => ({
  supabase: { functions: { invoke } },
}));

import {
  getBrandBookExport,
  requestBrandBookExport,
} from "../brandBookExportService";

const queued = {
  jobId: "job-1776",
  status: "queued",
  exportableCount: 0,
  omittedPersonCount: 0,
  omittedFieldCount: 0,
  result: null,
};

beforeEach(() => {
  invoke.mockReset();
});

describe("#1776 brand-book export service contract", () => {
  test("creates only a brand-owned, all-contacts, name-sorted export", async () => {
    invoke.mockResolvedValue({ data: queued, error: null });
    await expect(requestBrandBookExport({
      brandId: "d33e9214-bfb5-4cd8-8f15-0ce50f623bb9",
      clientRequestId: "17760000-0000-4000-8000-000000000001",
    })).resolves.toMatchObject({ jobId: "job-1776", status: "queued", exportableCount: 0 });
    expect(invoke).toHaveBeenCalledWith("brand-people-export", {
      body: {
        scope: "brand_book",
        brandId: "d33e9214-bfb5-4cd8-8f15-0ce50f623bb9",
        filter: "all",
        search: null,
        sort: "name_asc",
        filterSnapshot: {},
        clientRequestId: "17760000-0000-4000-8000-000000000001",
      },
    });
    expect(invoke.mock.calls[0][1].body).not.toHaveProperty("eventId");
  });

  test("status requests are minimal and preserve the fresh signed URL", async () => {
    invoke.mockResolvedValue({
      data: {
        ...queued,
        status: "ready",
        result: { fileName: "brand-book.csv", expiresAt: "2026-09-03T12:00:00Z" },
        signedUrl: "https://signed.example/brand-book.csv",
      },
      error: null,
    });
    await expect(getBrandBookExport("job-1776")).resolves.toMatchObject({
      status: "ready",
      signedUrl: "https://signed.example/brand-book.csv",
    });
    expect(invoke).toHaveBeenCalledWith("brand-people-export", {
      body: { operation: "status", jobId: "job-1776" },
    });
  });

  test("accepts a status response without a repeated count", async () => {
    const { exportableCount: _omitted, ...statusWithoutCount } = queued;
    invoke.mockResolvedValue({ data: statusWithoutCount, error: null });

    await expect(getBrandBookExport("job-1776")).resolves.toMatchObject({
      status: "queued",
      exportableCount: null,
    });
  });

  test("normalizes the backend's ready-without-result expiry window", async () => {
    invoke.mockResolvedValue({
      data: { ...queued, status: "ready", exportableCount: null },
      error: null,
    });

    await expect(getBrandBookExport("job-1776")).resolves.toMatchObject({
      status: "expired",
      result: null,
      signedUrl: null,
    });
  });

  test("rejects a ready download response without a fresh signed URL", async () => {
    invoke.mockResolvedValue({
      data: {
        ...queued,
        status: "ready",
        result: { fileName: "brand-book.csv", expiresAt: "2026-09-03T12:00:00Z" },
        signedUrl: null,
      },
      error: null,
    });

    await expect(getBrandBookExport("job-1776")).rejects.toEqual(
      expect.objectContaining({ code: "invalid_response" }),
    );
  });

  test("rejects a response that omits the authoritative export count", async () => {
    const { exportableCount: _missing, ...missingCount } = queued;
    invoke.mockResolvedValue({ data: missingCount, error: null });

    await expect(requestBrandBookExport({
      brandId: "d33e9214-bfb5-4cd8-8f15-0ce50f623bb9",
      clientRequestId: "17760000-0000-4000-8000-000000000002",
    })).rejects.toEqual(expect.objectContaining({ code: "invalid_response" }));
  });

  test("maps a real edge 403 to the permission state without leaking transport text", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: "opaque transport detail",
        context: {
          status: 403,
          clone: () => ({ text: async () => JSON.stringify({ error: "forbidden" }) }),
        },
      },
    });
    await expect(getBrandBookExport("job-1776")).rejects.toEqual(
      expect.objectContaining({ code: "forbidden" }),
    );
  });

  test("maps a real edge 401 to authentication without exposing malformed response text", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        message: "opaque transport detail",
        context: {
          status: 401,
          clone: () => ({ text: async () => "not-json" }),
        },
      },
    });

    await expect(getBrandBookExport("job-1776")).rejects.toEqual(
      expect.objectContaining({ code: "unauthorized" }),
    );
  });
});
