/**
 * #3184 [Ari no-website 500] — implementor happy path (T-I6, T-I7).
 *
 * Business web, iOS and Android share this copy module and service, so one
 * suite covers all three surfaces.
 *
 * The Ari chat used to show "Ari could not connect — check your connection" for
 * every code it had no copy for, so a role refusal, a conflict or a missing
 * website was blamed on a network that was fine. The connection sentence now
 * belongs to TRANSPORT_UNAVAILABLE alone, and agentChatService returns that
 * code only for a FunctionsFetchError (the request never reached Mingla).
 *
 * Fails if TRANSPORT_UNAVAILABLE loses the connection copy, if any other code
 * gains it, or if a FunctionsFetchError stops mapping to TRANSPORT_UNAVAILABLE.
 */

const mockInvoke = jest.fn();

jest.mock("../../../services/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => mockInvoke(...args) },
  },
}));

import {
  ARI_CHAT_CONNECTION_COPY,
  ariChatErrorCopy,
  shouldReportAriChatError,
} from "../ariChatErrorCopy";
import { ARI_CLIENT_ERROR_REGISTRY } from "../../../services/agentReliability";
import { sendAgentMessage } from "../../../services/agentChatService";

const INTERNAL_COPY =
  "Ari couldn't finish that request. Nothing was changed; try again shortly.";

// Codes the chat receives that are not registry families: client-origin codes
// and the retained legacy task-state codes.
const CLIENT_ORIGIN_CODES = [
  "ENVELOPE_INVALID",
  "EDGE_ERROR",
  "EMPTY",
  "IN_FLIGHT",
  "TASK_STATE_CONFLICT",
  "CHOICE_STALE",
  "TIMEZONE_REQUIRED",
  "PLANNER_UNAVAILABLE",
  "TASK_STATE_INVALID",
  "TASK_STATE_OVERSIZED",
  "TASK_RECOVERY_REQUIRED",
];

const REGISTRY_CODES = Object.keys(ARI_CLIENT_ERROR_REGISTRY);

describe("#3184 T-I6 Ari chat error copy never blames the connection for a refusal", () => {
  it("covers all twenty registry families", () => {
    // [TEST-MOD-APPROVED #3429] count only: #3429 added ATTACHMENT_INVALID,
    // ATTACHMENT_CONTEXT_LIMIT, TURN_STOPPED and ACCEPTED_RESPONSE_FAILED to
    // the registry on BOTH sides (the #2060 parity gate compares the complete
    // key sets and passes at 24/24). Every other assertion here is untouched.
    expect(REGISTRY_CODES).toHaveLength(24);
    expect(REGISTRY_CODES).toContain("TRANSPORT_UNAVAILABLE");
  });

  it.each([...REGISTRY_CODES, ...CLIENT_ORIGIN_CODES])(
    "%s has its own copy, and only TRANSPORT_UNAVAILABLE mentions the connection",
    (code) => {
      const copy = ariChatErrorCopy(code);
      expect(copy.length).toBeGreaterThan(0);
      if (code === "TRANSPORT_UNAVAILABLE") {
        expect(copy).toBe(ARI_CHAT_CONNECTION_COPY);
      } else {
        expect(copy).not.toBe(ARI_CHAT_CONNECTION_COPY);
        expect(copy).not.toMatch(/connection/i);
      }
    },
  );

  it("gives the no-website refusal families honest, non-network copy", () => {
    expect(ariChatErrorCopy("FORBIDDEN")).toBe(
      "Your role on this brand doesn't allow that. Nothing was changed.",
    );
    expect(ariChatErrorCopy("CONFLICT")).toBe(
      "Something changed while Ari was working. Nothing was changed; try again.",
    );
    expect(ariChatErrorCopy("DEPENDENCY_UNAVAILABLE")).toBe(
      "Ari can't reach part of Mingla right now. Nothing was changed; try again shortly.",
    );
    expect(ariChatErrorCopy("INTERNAL")).toBe(INTERNAL_COPY);
    expect(ariChatErrorCopy("EDGE_ERROR")).toBe(INTERNAL_COPY);
    expect(ariChatErrorCopy("ENVELOPE_INVALID")).toBe(
      "Ari replied but this app couldn't verify the response. That's on us — it's been reported.",
    );
  });

  it("falls back to INTERNAL copy for an unknown code and reports it", () => {
    for (const code of ["SITE_SERVICE_UNAVAILABLE", "SOMETHING_NEW", "", "constructor", "toString"]) {
      expect(ariChatErrorCopy(code)).toBe(INTERNAL_COPY);
      expect(shouldReportAriChatError(code)).toBe(true);
    }
  });

  it("reports exactly ENVELOPE_INVALID, EDGE_ERROR and codes without copy", () => {
    expect(shouldReportAriChatError("ENVELOPE_INVALID")).toBe(true);
    expect(shouldReportAriChatError("EDGE_ERROR")).toBe(true);
    const quiet = [...REGISTRY_CODES, ...CLIENT_ORIGIN_CODES].filter(
      (code) => code !== "ENVELOPE_INVALID" && code !== "EDGE_ERROR",
    );
    for (const code of quiet) {
      expect(shouldReportAriChatError(code)).toBe(false);
    }
  });
});

describe("#3184 T-I7 a real transport failure gets its own code", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("maps a FunctionsFetchError to TRANSPORT_UNAVAILABLE, whose copy is the connection sentence", async () => {
    const fetchError = Object.assign(
      new Error("Failed to send a request to the Edge Function"),
      { name: "FunctionsFetchError", context: new TypeError("Network request failed") },
    );
    mockInvoke.mockResolvedValue({ data: null, error: fetchError });

    const result = await sendAgentMessage({
      conversation_id: null,
      message: "I want to create a website",
      client_turn_id: "00000000-0000-4000-8000-000000003184",
      client_timezone: "America/New_York",
      locale: "en-US",
      brand_id: "brand-a",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected an error result");
    expect(result.code).toBe("TRANSPORT_UNAVAILABLE");
    expect(ariChatErrorCopy(result.code)).toBe(ARI_CHAT_CONNECTION_COPY);
    expect(shouldReportAriChatError(result.code)).toBe(false);
  });
});
