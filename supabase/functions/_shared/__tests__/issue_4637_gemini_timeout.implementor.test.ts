// MINGLA-INVARIANT: I-ARI-MODEL-CALL-HAS-DEADLINE | issue #4637 | Every blocking Gemini answer call accepts and forwards an abort signal so the turn can end inside its deadline instead of stranding a running attempt.

import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { stub } from "https://deno.land/std@0.224.0/testing/mock.ts";
import { callGemini, callGeminiStructured } from "../agentGemini.ts";
import { ariModelCallBudget, ariModelCallSignal } from "../ariModelDeadline.ts";

Deno.test("answer calls reserve commit time and retry only with eight seconds left", () => {
  const fresh = ariModelCallBudget({
    turnStartedAtMs: 1_000,
    turnDeadlineMs: 55_000,
    nowMs: 1_000,
  });
  assert(fresh.timeoutMs === 25_000);
  assert(fresh.canRetry);

  const boundary = ariModelCallBudget({
    turnStartedAtMs: 1_000,
    turnDeadlineMs: 55_000,
    nowMs: 48_000,
  });
  assert(boundary.turnRemainingMs === 8_000);
  assert(boundary.timeoutMs === 2_000);
  assert(boundary.canRetry);

  const tooLate = ariModelCallBudget({
    turnStartedAtMs: 1_000,
    turnDeadlineMs: 55_000,
    nowMs: 48_001,
  });
  assert(!tooLate.canRetry);

  const exhausted = ariModelCallBudget({
    turnStartedAtMs: 1_000,
    turnDeadlineMs: 55_000,
    nowMs: 50_001,
  });
  assert(exhausted.timeoutMs === 0);
  assert(ariModelCallSignal(exhausted).aborted);
});

Deno.test("callGemini forwards the caller deadline to provider fetch", async () => {
  const priorKey = Deno.env.get("GEMINI_API_KEY_ARI");
  const priorLocal = Deno.env.get("ARI_LOCAL_MODEL_ENABLED");
  Deno.env.set("GEMINI_API_KEY_ARI", "issue-4637-test-key");
  Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
  let sawSignal = false;
  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request, init?: RequestInit) => {
      assert(init?.signal, "provider fetch must receive the turn signal");
      sawSignal = true;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new DOMException("Aborted")),
          { once: true },
        );
      });
    },
  );
  try {
    const controller = new AbortController();
    const pending = callGemini({
      systemPrompt: "Answer plainly.",
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      tools: [],
      signal: controller.signal,
    });
    controller.abort(new DOMException("deadline", "TimeoutError"));
    await assertRejects(() => pending, DOMException, "deadline");
    assert(sawSignal);
  } finally {
    fetchStub.restore();
    if (priorKey === undefined) Deno.env.delete("GEMINI_API_KEY_ARI");
    else Deno.env.set("GEMINI_API_KEY_ARI", priorKey);
    if (priorLocal === undefined) Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
    else Deno.env.set("ARI_LOCAL_MODEL_ENABLED", priorLocal);
  }
});

Deno.test("callGemini supplies a provider deadline when an older caller omits one", async () => {
  const priorKey = Deno.env.get("GEMINI_API_KEY_ARI");
  const priorLocal = Deno.env.get("ARI_LOCAL_MODEL_ENABLED");
  Deno.env.set("GEMINI_API_KEY_ARI", "issue-4637-test-key");
  Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
  let sawSignal = false;
  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request, init?: RequestInit) => {
      sawSignal = init?.signal instanceof AbortSignal;
      return Promise.resolve(Response.json({
        candidates: [{
          content: { parts: [{ text: "Hello." }] },
          finishReason: "STOP",
        }],
        usageMetadata: {
          promptTokenCount: 10,
          candidatesTokenCount: 2,
          totalTokenCount: 12,
        },
      }));
    },
  );
  try {
    await callGemini({
      systemPrompt: "Answer plainly.",
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      tools: [],
    });
    assert(sawSignal, "provider fetch must always have an abort deadline");
  } finally {
    fetchStub.restore();
    if (priorKey === undefined) Deno.env.delete("GEMINI_API_KEY_ARI");
    else Deno.env.set("GEMINI_API_KEY_ARI", priorKey);
    if (priorLocal === undefined) Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
    else Deno.env.set("ARI_LOCAL_MODEL_ENABLED", priorLocal);
  }
});

Deno.test("callGemini does not retry after the turn retry budget closes", async () => {
  const priorKey = Deno.env.get("GEMINI_API_KEY_ARI");
  const priorLocal = Deno.env.get("ARI_LOCAL_MODEL_ENABLED");
  Deno.env.set("GEMINI_API_KEY_ARI", "issue-4637-test-key");
  Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
  let requests = 0;
  const fetchStub = stub(globalThis, "fetch", () => {
    requests += 1;
    return Promise.resolve(
      new Response("upstream unavailable", { status: 503 }),
    );
  });
  try {
    await assertRejects(() =>
      callGemini({
        systemPrompt: "Answer plainly.",
        contents: [{ role: "user", parts: [{ text: "hello" }] }],
        tools: [],
        canRetry: () => false,
      })
    );
    assert(requests === 1);
  } finally {
    fetchStub.restore();
    if (priorKey === undefined) Deno.env.delete("GEMINI_API_KEY_ARI");
    else Deno.env.set("GEMINI_API_KEY_ARI", priorKey);
    if (priorLocal === undefined) Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
    else Deno.env.set("ARI_LOCAL_MODEL_ENABLED", priorLocal);
  }
});

Deno.test("provider cached and thinking token counts survive both response parsers", async () => {
  const priorKey = Deno.env.get("GEMINI_API_KEY_ARI");
  const priorLocal = Deno.env.get("ARI_LOCAL_MODEL_ENABLED");
  Deno.env.set("GEMINI_API_KEY_ARI", "issue-4637-test-key");
  Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
  let request = 0;
  const fetchStub = stub(globalThis, "fetch", () => {
    request += 1;
    return Promise.resolve(Response.json({
      candidates: [{
        content: {
          parts: [{ text: request === 1 ? "Hello." : '{"ok":true}' }],
        },
        finishReason: "STOP",
      }],
      usageMetadata: {
        promptTokenCount: request === 1 ? 100 : 40,
        candidatesTokenCount: request === 1 ? 20 : 5,
        totalTokenCount: request === 1 ? 130 : 48,
        cachedContentTokenCount: request === 1 ? 60 : 30,
        thoughtsTokenCount: request === 1 ? 10 : 3,
      },
    }));
  });
  try {
    const answer = await callGemini({
      systemPrompt: "Answer plainly.",
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      tools: [],
    });
    assertEquals(answer.usage.cached_input_tokens, 60);
    assertEquals(answer.usage.thinking_tokens, 10);

    const structured = await callGeminiStructured({
      systemPrompt: "Return JSON.",
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      responseSchema: {
        type: "OBJECT",
        properties: { ok: { type: "BOOLEAN" } },
        required: ["ok"],
      },
    });
    assertEquals(structured.usage.cached_input_tokens, 30);
    assertEquals(structured.usage.thinking_tokens, 3);
  } finally {
    fetchStub.restore();
    if (priorKey === undefined) Deno.env.delete("GEMINI_API_KEY_ARI");
    else Deno.env.set("GEMINI_API_KEY_ARI", priorKey);
    if (priorLocal === undefined) Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
    else Deno.env.set("ARI_LOCAL_MODEL_ENABLED", priorLocal);
  }
});

Deno.test("callGemini aggregates billed usage across provider repair attempts", async () => {
  const priorKey = Deno.env.get("GEMINI_API_KEY_ARI");
  const priorLocal = Deno.env.get("ARI_LOCAL_MODEL_ENABLED");
  Deno.env.set("GEMINI_API_KEY_ARI", "issue-4637-test-key");
  Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
  let request = 0;
  const fetchStub = stub(globalThis, "fetch", () => {
    request += 1;
    return Promise.resolve(Response.json({
      candidates: [{
        content: { parts: request === 1 ? [] : [{ text: "Repaired." }] },
        finishReason: request === 1 ? "MALFORMED_FUNCTION_CALL" : "STOP",
      }],
      usageMetadata: {
        promptTokenCount: request === 1 ? 100 : 200,
        candidatesTokenCount: request === 1 ? 10 : 20,
        totalTokenCount: request === 1 ? 112 : 223,
        cachedContentTokenCount: request === 1 ? 5 : 7,
        thoughtsTokenCount: request === 1 ? 2 : 3,
      },
    }));
  });
  try {
    const answer = await callGemini({
      systemPrompt: "Answer plainly.",
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      tools: [],
    });
    assertEquals(answer.attemptCount, 2);
    assertEquals(answer.usage, {
      prompt_tokens: 300,
      completion_tokens: 30,
      total_tokens: 335,
      cached_input_tokens: 12,
      thinking_tokens: 5,
    });
  } finally {
    fetchStub.restore();
    if (priorKey === undefined) Deno.env.delete("GEMINI_API_KEY_ARI");
    else Deno.env.set("GEMINI_API_KEY_ARI", priorKey);
    if (priorLocal === undefined) Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
    else Deno.env.set("ARI_LOCAL_MODEL_ENABLED", priorLocal);
  }
});

Deno.test("callGemini forwards the caller deadline to the local verification model", async () => {
  const priorLocal = Deno.env.get("ARI_LOCAL_MODEL_ENABLED");
  const priorBase = Deno.env.get("ARI_LOCAL_MODEL_BASE_URL");
  Deno.env.set("ARI_LOCAL_MODEL_ENABLED", "true");
  Deno.env.set("ARI_LOCAL_MODEL_BASE_URL", "http://127.0.0.1:11434");
  let sawCallerSignal = false;
  const controller = new AbortController();
  const fetchStub = stub(
    globalThis,
    "fetch",
    (_input: string | URL | Request, init?: RequestInit) => {
      sawCallerSignal = init?.signal === controller.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener(
          "abort",
          () => reject(init.signal?.reason ?? new DOMException("Aborted")),
          { once: true },
        );
      });
    },
  );
  try {
    const pending = callGemini({
      systemPrompt: "Answer plainly.",
      contents: [{ role: "user", parts: [{ text: "hello" }] }],
      tools: [],
      signal: controller.signal,
    });
    controller.abort(new DOMException("deadline", "TimeoutError"));
    await assertRejects(() => pending, DOMException, "deadline");
    assert(sawCallerSignal);
  } finally {
    fetchStub.restore();
    if (priorLocal === undefined) Deno.env.delete("ARI_LOCAL_MODEL_ENABLED");
    else Deno.env.set("ARI_LOCAL_MODEL_ENABLED", priorLocal);
    if (priorBase === undefined) Deno.env.delete("ARI_LOCAL_MODEL_BASE_URL");
    else Deno.env.set("ARI_LOCAL_MODEL_BASE_URL", priorBase);
  }
});

Deno.test("post-approval answer calls share the continuation deadline and retry budget", async () => {
  for (
    const path of ["../agentPostApproval.ts", "../agentPostApprovalLegacy.ts"]
  ) {
    const source = await Deno.readTextFile(new URL(path, import.meta.url));
    assertStringIncludes(source, "const continuationStartedAt = Date.now()");
    assertStringIncludes(source, "ariModelCallBudget({");
    assertStringIncludes(source, "ariModelCallSignal(budget)");
    assertStringIncludes(source, "signal,");
    assertStringIncludes(source, "canRetry,");
  }
});
