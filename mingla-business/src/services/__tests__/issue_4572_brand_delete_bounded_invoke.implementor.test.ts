/**
 * #4572 regression: draft discard must use the bounded authenticated edge
 * caller so an auth lock cannot swallow the request before the network, while
 * preserving structured server refusals for the UI.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockInvokeLaneFunction = jest.fn<
  (...args: unknown[]) => Promise<{ data: unknown; error: unknown }>
>();

jest.mock("../laneEdgeInvoke", () => ({
  invokeLaneFunction: (...args: unknown[]) => mockInvokeLaneFunction(...args),
}));

import { discardDraftBrand } from "../brandSetupService";

beforeEach(() => {
  mockInvokeLaneFunction.mockReset();
});

describe("#4572 bounded brand-delete invocation", () => {
  test("sends discard_draft through the bounded caller and accepts only explicit ok", async () => {
    mockInvokeLaneFunction.mockResolvedValue({
      data: { ok: true, stripe: "none", paystack: "none" },
      error: null,
    });

    await expect(discardDraftBrand("brand-4572")).resolves.toEqual({
      ok: true,
      stripe: "none",
      paystack: "none",
    });
    expect(mockInvokeLaneFunction).toHaveBeenCalledWith("brand-delete", {
      body: { brand_id: "brand-4572", mode: "discard_draft" },
    });
  });

  test("returns the server's no-longer-draft refusal instead of erasing it", async () => {
    const response = new Response(JSON.stringify({ error: "not_a_draft" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
    mockInvokeLaneFunction.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("non-2xx"), { context: response }),
    });

    await expect(discardDraftBrand("brand-4572")).resolves.toEqual({
      ok: false,
      error: "not_a_draft",
    });
  });

  test("a transport failure rejects with its real message for UI classification", async () => {
    mockInvokeLaneFunction.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("Failed to send a request to the Edge Function"), {
        name: "FunctionsFetchError",
      }),
    });

    await expect(discardDraftBrand("brand-4572")).rejects.toThrow(
      "Failed to send a request to the Edge Function",
    );
  });

  test("an unstructured 401 keeps its HTTP status for the sign-in-expired message", async () => {
    const response = new Response(JSON.stringify({ error: "invalid_jwt" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
    mockInvokeLaneFunction.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("non-2xx"), { context: response }),
    });

    await expect(discardDraftBrand("brand-4572")).rejects.toMatchObject({ status: 401 });
  });

  test("a malformed 2xx response fails closed and never evicts the draft", async () => {
    mockInvokeLaneFunction.mockResolvedValue({ data: {}, error: null });
    await expect(discardDraftBrand("brand-4572")).rejects.toThrow(
      "brand-delete returned an invalid response",
    );
  });
});
