/**
 * #4572 regression: draft discard must send with AuthContext's already-held
 * token so an auth lock cannot swallow the request before the network, while
 * preserving structured server refusals for the UI.
 */
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

const mockSupabaseFetch = jest.fn<
  (url: string, init: RequestInit) => Promise<Response>
>();
const mockFallbackInvoke = jest.fn();

jest.mock("../supabase", () => ({
  laneEdgeEndpoint: {
    functionsUrl: "https://project.supabase.co/functions/v1",
    anonKey: "anon-4572",
    headers: { "x-client-info": "test" },
  },
  supabaseFetch: (url: string, init: RequestInit) =>
    mockSupabaseFetch(url, init),
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockFallbackInvoke(...args) },
  },
}));

import { discardDraftBrand } from "../brandSetupService";

beforeEach(() => {
  mockSupabaseFetch.mockReset();
  mockFallbackInvoke.mockReset();
});

describe("#4572 pre-attached brand-delete invocation", () => {
  test("sends discard_draft immediately with the held token and accepts only explicit ok", async () => {
    mockSupabaseFetch.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      stripe: "none",
      paystack: "none",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    await expect(discardDraftBrand("brand-4572", "jwt-4572")).resolves.toEqual({
      ok: true,
      stripe: "none",
      paystack: "none",
    });
    expect(mockSupabaseFetch).toHaveBeenCalledWith(
      "https://project.supabase.co/functions/v1/brand-delete",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer jwt-4572" }),
        body: JSON.stringify({ brand_id: "brand-4572", mode: "discard_draft" }),
      }),
    );
    expect(mockFallbackInvoke).not.toHaveBeenCalled();
  });

  test("returns the server's no-longer-draft refusal instead of erasing it", async () => {
    const response = new Response(JSON.stringify({ error: "not_a_draft" }), {
      status: 409,
      headers: { "Content-Type": "application/json" },
    });
    mockSupabaseFetch.mockResolvedValue(response);

    await expect(discardDraftBrand("brand-4572", "jwt-4572")).resolves.toEqual({
      ok: false,
      error: "not_a_draft",
    });
  });

  test("a transport failure rejects with its real message for UI classification", async () => {
    mockSupabaseFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(discardDraftBrand("brand-4572", "jwt-4572")).rejects.toThrow(
      "Failed to send a request to the Edge Function",
    );
  });

  test("an unstructured 401 keeps its HTTP status for the sign-in-expired message", async () => {
    const response = new Response(JSON.stringify({ error: "invalid_jwt" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
    mockSupabaseFetch.mockResolvedValue(response);

    await expect(discardDraftBrand("brand-4572", "jwt-4572")).rejects.toMatchObject({ status: 401 });
  });

  test("a malformed 2xx response fails closed and never evicts the draft", async () => {
    mockSupabaseFetch.mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    await expect(discardDraftBrand("brand-4572", "jwt-4572")).rejects.toThrow(
      "brand-delete returned an invalid response",
    );
  });

  test("without an attached token it names the auth wait and sends nothing", async () => {
    await expect(discardDraftBrand("brand-4572", null)).rejects.toMatchObject({
      name: "BusinessAuthNotReadyError",
    });
    expect(mockSupabaseFetch).not.toHaveBeenCalled();
    expect(mockFallbackInvoke).not.toHaveBeenCalled();
  });
});
