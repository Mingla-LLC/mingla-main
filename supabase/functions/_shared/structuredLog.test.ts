import {
  logError,
  structuredLog,
  wrapEdgeHandler,
} from "./structuredLog.ts";

function captureConsole(
  method: "log" | "error" | "warn",
): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const original = console[method];
  console[method] = (...args: unknown[]) => {
    lines.push(String(args[0]));
  };
  return {
    lines,
    restore: () => {
      console[method] = original;
    },
  };
}

Deno.test("structuredLog emits JSON with level and message", () => {
  const cap = captureConsole("log");
  try {
    structuredLog("info", "hello", { fn: "test-fn" });
    const payload = JSON.parse(cap.lines[0]!);
    if (payload.level !== "info" || payload.message !== "hello" || payload.fn !== "test-fn") {
      throw new Error(`unexpected payload: ${cap.lines[0]}`);
    }
  } finally {
    cap.restore();
  }
});

Deno.test("logError routes to console.error with err field", () => {
  const cap = captureConsole("error");
  try {
    logError("boom", new Error("kapow"), { fn: "agent-chat" });
    const payload = JSON.parse(cap.lines[0]!);
    if (payload.level !== "error" || payload.err !== "kapow") {
      throw new Error(`unexpected payload: ${cap.lines[0]}`);
    }
  } finally {
    cap.restore();
  }
});

Deno.test("wrapEdgeHandler logs and returns onError response", async () => {
  const cap = captureConsole("error");
  try {
    const handler = wrapEdgeHandler(
      "ticket-checkout-status",
      async () => {
        throw new Error("db down");
      },
      {
        onError: (_err, requestId) =>
          new Response(JSON.stringify({ error: "status_lookup_failed", requestId }), {
            status: 500,
          }),
      },
    );
    const res = await handler(new Request("https://example.com", { method: "POST" }));
    if (res.status !== 500) throw new Error(`expected 500, got ${res.status}`);
    const body = await res.json();
    if (body.error !== "status_lookup_failed" || !body.requestId) {
      throw new Error(`unexpected body: ${JSON.stringify(body)}`);
    }
    const payload = JSON.parse(cap.lines[0]!);
    if (!payload.message.includes("unhandled")) {
      throw new Error(`expected unhandled log, got ${cap.lines[0]}`);
    }
  } finally {
    cap.restore();
  }
});
