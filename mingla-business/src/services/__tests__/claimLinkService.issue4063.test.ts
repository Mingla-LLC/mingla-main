import { mintClaimLinkHandoff } from "../claimLinkService";

const mockInvoke = jest.fn();

jest.mock("../supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

function functionError(payload: unknown): { context: Response } {
  return { context: Response.json(payload, { status: 429 }) };
}

beforeEach(() => mockInvoke.mockReset());

describe("#4063 claim-link handoff client", () => {
  test("normalises the code and returns the bounded handoff", async () => {
    mockInvoke.mockResolvedValue({
      data: {
        ok: true,
        handoffUrl: "https://usemingla.com/c/HANDOFF123",
        expiresAt: "2026-10-24T16:00:00.000Z",
      },
      error: null,
    });

    await expect(mintClaimLinkHandoff(" abcd123456 ")).resolves.toEqual({
      ok: true,
      handoffUrl: "https://usemingla.com/c/HANDOFF123",
      expiresAt: "2026-10-24T16:00:00.000Z",
    });
    expect(mockInvoke).toHaveBeenCalledWith("claim-link", {
      body: { op: "handoff", code: "ABCD123456" },
    });
  });

  test("refuses malformed codes before transport", async () => {
    await expect(mintClaimLinkHandoff("short")).resolves.toEqual({
      ok: false,
      reason: "invalid",
      retryAfterSeconds: null,
    });
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  test("maps a rate-limited edge response", async () => {
    mockInvoke.mockResolvedValue({
      data: null,
      error: functionError({ error: "rate_limited", retryAfterSeconds: 60 }),
    });
    await expect(mintClaimLinkHandoff("ABCD123456")).resolves.toEqual({
      ok: false,
      reason: "rate_limited",
      retryAfterSeconds: 60,
    });
  });

  test("fails closed on a malformed success or network error", async () => {
    mockInvoke.mockResolvedValueOnce({
      data: { ok: true, handoffUrl: "javascript:alert(1)", expiresAt: "never" },
      error: null,
    });
    await expect(mintClaimLinkHandoff("ABCD123456")).resolves.toEqual({
      ok: false,
      reason: "invalid",
      retryAfterSeconds: null,
    });

    mockInvoke.mockRejectedValueOnce(new Error("offline"));
    await expect(mintClaimLinkHandoff("ABCD123456")).resolves.toEqual({
      ok: false,
      reason: "network",
      retryAfterSeconds: null,
    });
  });
});
