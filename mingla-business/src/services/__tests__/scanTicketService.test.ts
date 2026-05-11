/* eslint-disable import/first */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockInvoke = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
>();

jest.mock("../supabase", () => ({
  supabase: {
    functions: {
      invoke: (...args: unknown[]) => mockInvoke(...args),
    },
  },
}));

import {
  ScanTicketError,
  scanTicket,
  type ScanTicketErrorCode,
} from "../scanTicketService";

// Build a Response-like object that mirrors what supabase-js's
// FunctionsHttpError exposes as `error.context`. We use a plain object
// with `.status` + `.text()` because the duck-typed parser in
// scanTicketService.ts deliberately avoids `instanceof Response` (RN
// polyfill realm fix).
const fakeResponse = (status: number, body: string): Response => {
  const obj = {
    status,
    text: async () => body,
  };
  return obj as unknown as Response;
};

const fakeFunctionsHttpError = (
  status: number,
  bodyJson: Record<string, unknown> | string,
): Error & { context: Response } => {
  const body =
    typeof bodyJson === "string" ? bodyJson : JSON.stringify(bodyJson);
  const err = new Error("Edge Function returned a non-2xx status code") as Error & {
    context: Response;
  };
  err.context = fakeResponse(status, body);
  return err;
};

describe("scanTicketService", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  test("returns ServerScanResult on success", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: {
        result: "success",
        scanId: "scan-1",
        ticketId: "ticket-1",
        orderId: "order-1",
        buyerName: "Test Buyer",
        ticketName: "GA",
      },
      error: null,
    });

    const result = await scanTicket("event-1", "qr-payload");

    expect(result.result).toBe("success");
    expect(result.buyerName).toBe("Test Buyer");
  });

  test("throws ScanTicketError with code scanner_not_authorized on 403 with matching detail", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: fakeFunctionsHttpError(403, {
        error: "scan_failed",
        detail: "scanner_not_authorized",
      }),
    });

    await expect(scanTicket("event-1", "qr-payload")).rejects.toMatchObject({
      name: "ScanTicketError",
      code: "scanner_not_authorized" satisfies ScanTicketErrorCode,
      status: 403,
      detail: "scanner_not_authorized",
    });
  });

  test("throws ScanTicketError with code auth_required on 401", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: fakeFunctionsHttpError(401, { error: "auth_required" }),
    });

    await expect(scanTicket("event-1", "qr-payload")).rejects.toMatchObject({
      name: "ScanTicketError",
      code: "auth_required" satisfies ScanTicketErrorCode,
      status: 401,
    });
  });

  test("throws ScanTicketError with code scan_failed when detail is absent", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: fakeFunctionsHttpError(400, { error: "scan_failed" }),
    });

    await expect(scanTicket("event-1", "qr-payload")).rejects.toMatchObject({
      name: "ScanTicketError",
      code: "scan_failed" satisfies ScanTicketErrorCode,
      status: 400,
      detail: null,
    });
  });

  test("throws ScanTicketError with code unknown when body is non-JSON", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: fakeFunctionsHttpError(500, "Internal Server Error"),
    });

    await expect(scanTicket("event-1", "qr-payload")).rejects.toMatchObject({
      name: "ScanTicketError",
      code: "unknown" satisfies ScanTicketErrorCode,
      status: 500,
      detail: null,
    });
  });

  test("the thrown error is instanceof ScanTicketError AND instanceof Error", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: null,
      error: fakeFunctionsHttpError(403, {
        error: "scan_failed",
        detail: "scanner_not_authorized",
      }),
    });

    let caught: unknown;
    try {
      await scanTicket("event-1", "qr-payload");
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ScanTicketError);
    expect(caught).toBeInstanceOf(Error);
  });
});
