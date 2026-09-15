/**
 * #3184 [Ari no-website 500] — tester adversarial suite (T-A7, Business).
 *
 * Business web, iOS and Android share agentChatService and the Ari chat copy
 * module, so this one suite covers all three surfaces.
 *
 * The implementor's suite checks the copy table and a hand-built error object
 * named "FunctionsFetchError". This suite instead drives the REAL
 * @supabase/functions-js client the app ships (FunctionsClient, the library
 * behind `supabase.functions.invoke`) with a scripted network, then feeds the
 * real `extractError` result into the real `ariChatErrorCopy`. It attacks both
 * directions of laundering:
 *
 *   - only a request that never reached Mingla may say "check your
 *     connection"; a relay error, a gateway page, a refusal envelope, an
 *     invalid envelope, or a server message that itself mentions the
 *     connection must not;
 *   - a real transport failure must still get the connection copy, on every
 *     Ari call that shares extractError.
 *
 * Fails on revert of agentChatService.ts (FunctionsFetchError -> EDGE_ERROR),
 * of ariChatErrorCopy.ts (module absent), or of AriChatScreen.tsx (inline
 * copy table with the connection fallback).
 */

import * as fs from "fs";
import * as path from "path";

const mockFetch = jest.fn();

jest.mock("../supabase", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { FunctionsClient } = require("@supabase/functions-js");
  return {
    supabase: {
      functions: new FunctionsClient(
        "https://fixture-3184.supabase.co/functions/v1",
        {
          headers: { Authorization: "Bearer fixture" },
          customFetch: (...args: unknown[]) => mockFetch(...args),
        },
      ),
    },
  };
});

import {
  ARI_CLIENT_ERROR_REGISTRY,
  type AriErrorCode,
} from "../agentReliability";
import {
  cancelAgentAction,
  confirmAgentAction,
  sendAgentMessage,
} from "../agentChatService";
import {
  ARI_CHAT_CONNECTION_COPY,
  ariChatErrorCopy,
  shouldReportAriChatError,
} from "../../screens/ari/ariChatErrorCopy";

const CONNECTION_WORDS = /connect|network|wi-?fi|internet|signal/i;
const RELEASE = "0123456789abcdef0123456789abcdef01234567";
const REQUEST_ID = "5d2c7e1a-3b4f-4c6d-8e9f-0a1b2c3d4e5f";
const TURN_ID = "6e3d8f2b-4c5a-4d7e-9f0a-1b2c3d4e5f60";

const SEND_ARGS = {
  conversation_id: null,
  message: "I want to create a website",
  client_turn_id: TURN_ID,
  client_timezone: "Europe/London",
  locale: "en-GB",
  brand_id: "brand-3184",
};

function errorEnvelope(
  code: AriErrorCode,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const tuple = ARI_CLIENT_ERROR_REGISTRY[code];
  return {
    protocol_version: 1,
    kind: "error",
    code,
    user_message: "Server-owned registry copy.",
    retryability: tuple.retryability,
    safe_to_retry: tuple.safeToRetry,
    operation_state: tuple.operationState,
    request_id: REQUEST_ID,
    client_turn_id: TURN_ID,
    execution_id: null,
    release_sha: RELEASE,
    function_version: "agent-chat-3184",
    ...overrides,
  };
}

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

async function toastFor(
  answer: () => Promise<Response>,
): Promise<{ code: string; copy: string; reported: boolean }> {
  mockFetch.mockImplementationOnce(answer);
  const result = await sendAgentMessage(SEND_ARGS);
  expect(mockFetch).toHaveBeenCalledTimes(1);
  if (result.kind !== "error") {
    throw new Error(`expected an error result, got ${result.kind}`);
  }
  return {
    code: result.code,
    copy: ariChatErrorCopy(result.code),
    reported: shouldReportAriChatError(result.code),
  };
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("#3184 T-A7 a request that never reached Mingla is the only connection failure", () => {
  it.each([
    ["a DNS / socket failure", () => Promise.reject(new TypeError("Network request failed"))],
    [
      "an aborted request",
      () => Promise.reject(Object.assign(new Error("The operation was aborted."), { name: "AbortError" })),
    ],
    ["a TLS failure with a hostile message", () => Promise.reject(new Error("FORBIDDEN <html>certificate</html>"))],
  ])("%s through the real functions client gets the connection copy", async (_label, answer) => {
    const toast = await toastFor(answer);
    expect(toast.code).toBe("TRANSPORT_UNAVAILABLE");
    expect(toast.copy).toBe(ARI_CHAT_CONNECTION_COPY);
    expect(toast.reported).toBe(false);
  });

  it("every Ari call sharing extractError classifies a fetch failure the same way", async () => {
    mockFetch.mockImplementation(() => Promise.reject(new TypeError("Network request failed")));
    const confirm = await confirmAgentAction({ pending_action_id: "pa-3184" });
    const cancel = await cancelAgentAction("pa-3184");
    for (const result of [confirm, cancel]) {
      expect(result.kind).toBe("error");
      if (result.kind !== "error") continue;
      expect(result.code).toBe("TRANSPORT_UNAVAILABLE");
      // The raw library sentence is not surfaced as the user message.
      expect(result.message).not.toMatch(/Edge Function/);
    }
  });
});

describe("#3184 T-A7 a server that answered is never blamed on the connection", () => {
  it("a relay error (x-relay-error: true) is not a transport failure", async () => {
    const toast = await toastFor(async () =>
      jsonResponse(502, { message: "Function not reachable from relay" }, { "x-relay-error": "true" }),
    );
    expect(toast.code).not.toBe("TRANSPORT_UNAVAILABLE");
    expect(toast.copy).not.toBe(ARI_CHAT_CONNECTION_COPY);
    expect(toast.copy).not.toMatch(CONNECTION_WORDS);
    expect(toast.reported).toBe(true);
  });

  it("a relay error carrying a connection-shaped envelope still does not get connection copy unless its code says so", async () => {
    const toast = await toastFor(async () =>
      jsonResponse(503, errorEnvelope("DEPENDENCY_UNAVAILABLE", {
        user_message: "Ari could not connect. Retry when your connection is stable.",
      }), { "x-relay-error": "true" }),
    );
    expect(toast.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(toast.copy).not.toMatch(CONNECTION_WORDS);
  });

  it("a gateway HTML page is an unclassified edge error with honest copy, and it is reported", async () => {
    const toast = await toastFor(async () =>
      new Response("<!DOCTYPE html><html><body>502 Bad Gateway</body></html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );
    expect(toast.code).toBe("EDGE_ERROR");
    expect(toast.copy).not.toMatch(CONNECTION_WORDS);
    expect(toast.reported).toBe(true);
  });

  it.each([
    [403, "FORBIDDEN"],
    [409, "CONFLICT"],
    [409, "STALE_PROPOSAL"],
    [400, "VALIDATION_FAILED"],
    [503, "DEPENDENCY_UNAVAILABLE"],
    [500, "INTERNAL"],
  ] as Array<[number, AriErrorCode]>)(
    "a %i %s refusal envelope keeps its exact code and non-network copy",
    async (status, code) => {
      const toast = await toastFor(async () => jsonResponse(status, errorEnvelope(code)));
      expect(toast.code).toBe(code);
      expect(toast.copy).not.toMatch(CONNECTION_WORDS);
      expect(toast.copy).toBe(ariChatErrorCopy(code));
      expect(toast.reported).toBe(false);
    },
  );

  it("the toast copy comes from the code, never from a server user_message that mentions the connection", async () => {
    const toast = await toastFor(async () =>
      jsonResponse(403, errorEnvelope("FORBIDDEN", {
        user_message: "Check your connection and try again.",
      })),
    );
    expect(toast.code).toBe("FORBIDDEN");
    expect(toast.copy).toBe("Your role on this brand doesn't allow that. Nothing was changed.");
  });

  it("an envelope this app refuses (unattested release) is ENVELOPE_INVALID, reported, not a connection problem", async () => {
    const toast = await toastFor(async () =>
      jsonResponse(403, errorEnvelope("FORBIDDEN", { release_sha: "unattested", function_version: "unknown" })),
    );
    expect(toast.code).toBe("ENVELOPE_INVALID");
    expect(toast.copy).not.toMatch(CONNECTION_WORDS);
    expect(toast.reported).toBe(true);
  });

  it("an empty-body 403 is FORBIDDEN, not a connection problem", async () => {
    const toast = await toastFor(async () => new Response("", { status: 403 }));
    expect(toast.code).toBe("FORBIDDEN");
    expect(toast.copy).not.toMatch(CONNECTION_WORDS);
  });

  it("a legacy JSON body naming a transport-looking code in the wrong case does not unlock connection copy", async () => {
    const toast = await toastFor(async () =>
      jsonResponse(500, { code: "transport_unavailable", message: "upstream went away" }),
    );
    expect(toast.code).toBe("transport_unavailable");
    expect(toast.copy).not.toBe(ARI_CHAT_CONNECTION_COPY);
    expect(toast.reported).toBe(true);
  });

  it("every registry family delivered as a real server envelope avoids connection copy (the two device-side families excepted)", async () => {
    const families = Object.keys(ARI_CLIENT_ERROR_REGISTRY) as AriErrorCode[];
    expect(families).toContain("TRANSPORT_UNAVAILABLE");
    expect(families).toContain("OFFLINE");
    // OFFLINE is raised by the device's own reachability gate and says so
    // ("You're offline. Reconnect..."); it is still not the connection sentence.
    expect(ariChatErrorCopy("OFFLINE")).not.toBe(ARI_CHAT_CONNECTION_COPY);
    expect(ariChatErrorCopy("OFFLINE")).not.toMatch(/check your connection/i);
    for (const code of families) {
      if (code === "TRANSPORT_UNAVAILABLE" || code === "OFFLINE") continue;
      mockFetch.mockReset();
      const toast = await toastFor(async () => jsonResponse(code === "RATE_LIMITED" ? 429 : 409, errorEnvelope(code)));
      expect({ code: toast.code, connection: CONNECTION_WORDS.test(toast.copy) }).toEqual({
        code,
        connection: false,
      });
    }
  });

  it.each(["__proto__", "hasOwnProperty", "TRANSPORT_UNAVAILABLE ", " TRANSPORT_UNAVAILABLE", "Transport_Unavailable"])(
    "the lookalike code %p never receives connection copy",
    (code) => {
      expect(ariChatErrorCopy(code)).not.toBe(ARI_CHAT_CONNECTION_COPY);
      expect(shouldReportAriChatError(code)).toBe(true);
    },
  );
});

describe("#3184 T-A7 the Ari chat screen takes its toast from the copy module", () => {
  const screen = fs.readFileSync(
    path.join(__dirname, "../../screens/ari/AriChatScreen.tsx"),
    "utf8",
  );

  it("owns no connection sentence of its own", () => {
    expect(screen).not.toMatch(/check your connection/i);
    expect(screen).not.toContain(ARI_CHAT_CONNECTION_COPY);
  });

  it("routes the send failure toast and its report through the module", () => {
    expect(screen).toContain('from "./ariChatErrorCopy"');
    expect(screen).toContain("setLocalError(ariChatErrorCopy(result.code));");
    expect(screen).toContain("if (shouldReportAriChatError(result.code)) {");
    // The #3186 lazy reporter survives: no module-scope diagnostics import.
    expect(screen).not.toMatch(/^import[^\n]*diagnostics\/reportNonFatal/m);
    expect(screen).toMatch(/await import\(\s*"\.\.\/\.\.\/diagnostics\/reportNonFatal"/);
  });
});
