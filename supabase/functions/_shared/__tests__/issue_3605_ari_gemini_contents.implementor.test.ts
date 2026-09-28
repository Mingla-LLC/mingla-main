/**
 * issue #3605 — implementor happy path for the two Gemini 3.x contents rules.
 *
 * Both defects in #3605 were one missing guarantee: the transcript Ari sends
 * to `gemini-3.6-flash` can contain a functionCall with no thought signature,
 * or a functionResponse with no call turn in front of it, and the provider
 * answers HTTP 400 to both. Production on 2026-09-28 produced exactly these
 * two 400s, so both shapes below are the real ones, not invented ones.
 *
 * The runtime assertions read the BODY that callGemini actually puts on the
 * wire. A source-string assertion would pass over a repair that never ran.
 */

import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { callGemini, type GeminiContentMessage } from "../agentGemini.ts";
import { repairGeminiContents } from "../agentGeminiContents.ts";

type Part = GeminiContentMessage["parts"][number];

function hasFunctionCall(part: Part): boolean {
  return typeof part === "object" && part !== null && "functionCall" in part;
}

function hasFunctionResponse(part: Part): boolean {
  return typeof part === "object" && part !== null &&
    "functionResponse" in part;
}

/**
 * The exact window agent-chat rebuilt at 10:49:38 UTC on 2026-09-28.
 *
 * HISTORY_WINDOW is 10 messages. By the eleventh message the window's head was
 * the `role='tool'` row for get_brand_site — an inline read writes a tool row
 * and NO matching assistant/tool_calls row, so the head of the window was a
 * functionResponse with nothing in front of it. Gemini answered: "Please
 * ensure that function response turn comes immediately after a function call
 * turn. Got function response with name 'get_brand_site'."
 */
function productionWindow(): GeminiContentMessage[] {
  return [
    {
      role: "user",
      parts: [{
        functionResponse: {
          name: "get_brand_site",
          response: { result: { site_id: "90f19f28", status: "published" } },
        },
      }],
    },
    { role: "model", parts: [{ text: "Here's what I found." }] },
    {
      role: "user",
      parts: [{ text: "<user_data>\nOn the About page…\n</user_data>" }],
    },
    {
      role: "user",
      parts: [{
        functionResponse: {
          name: "get_site_page",
          response: { result: { page_role: "about", revision: "r7" } },
        },
      }],
    },
    { role: "model", parts: [{ text: "Here's what I found." }] },
    {
      role: "user",
      parts: [{
        text: "<user_data>\nChange the SEO description…\n</user_data>",
      }],
    },
  ];
}

Deno.test("#3605 implementor: the production window loses every orphan functionResponse", () => {
  const { contents, repairs } = repairGeminiContents(productionWindow());

  assertEquals(repairs.orphanResponses, 2);
  assertEquals(repairs.unsignedCalls, 0);
  for (const content of contents) {
    for (const part of content.parts) {
      assert(
        !hasFunctionResponse(part),
        "an unpaired functionResponse survived the repair",
      );
    }
  }
  // Repair, not deletion: the read the user already paid for is still legible.
  const flattened = JSON.stringify(contents);
  assertStringIncludes(flattened, "get_brand_site");
  assertStringIncludes(flattened, "90f19f28");
  assertStringIncludes(flattened, "get_site_page");
  assertStringIncludes(flattened, "about");
});

Deno.test("#3605 implementor: a SIGNED call and its response survive untouched", () => {
  const signed: GeminiContentMessage[] = [
    {
      role: "user",
      parts: [{ text: "<user_data>\nList my pages\n</user_data>" }],
    },
    {
      role: "model",
      parts: [{
        functionCall: { name: "list_site_pages", args: { site_id: "s1" } },
        thoughtSignature: "SIG_FROM_THE_MODEL",
      }],
    },
    {
      role: "user",
      parts: [{
        functionResponse: {
          name: "list_site_pages",
          response: { result: { pages: ["home", "menu"] } },
        },
      }],
    },
  ];

  const { contents, repairs } = repairGeminiContents(signed);

  assertEquals(repairs.unsignedCalls, 0);
  assertEquals(repairs.orphanResponses, 0);
  assertEquals(contents.length, 3);
  assert(
    hasFunctionCall(contents[1].parts[0]),
    "the signed call was rewritten",
  );
  assert(
    hasFunctionResponse(contents[2].parts[0]),
    "the paired response was rewritten",
  );
  assertEquals(
    (contents[1].parts[0] as { thoughtSignature?: string }).thoughtSignature,
    "SIG_FROM_THE_MODEL",
  );
});

Deno.test("#3605 implementor: an UNSIGNED call never reaches the wire", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = Deno.env.get("GEMINI_API_KEY_ARI");
  Deno.env.set("GEMINI_API_KEY_ARI", "test-key-not-a-real-secret");
  let sentBody: { contents?: GeminiContentMessage[] } | null = null;

  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body ?? "{}"));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          candidates: [{
            content: { parts: [{ text: "Your website has five pages." }] },
            finishReason: "STOP",
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }) as unknown as typeof fetch;

  try {
    // The follow-up shape agent-chat builds: an echoed call plus its response.
    // Before #3605 the echo carried no signature and Gemini 400'd the request,
    // which the follow-up's catch turned into "Here's what I found.".
    const result = await callGemini({
      systemPrompt: "system",
      contents: [
        {
          role: "user",
          parts: [{ text: "<user_data>\nList pages\n</user_data>" }],
        },
        {
          role: "model",
          parts: [{
            functionCall: { name: "list_site_pages", args: { site_id: "s1" } },
          }],
        },
        {
          role: "user",
          parts: [{
            functionResponse: {
              name: "list_site_pages",
              response: { result: { pages: ["home"] } },
            },
          }],
        },
      ],
      tools: [],
    });

    assertEquals(result.textResponse, "Your website has five pages.");
    const wire = sentBody as { contents?: GeminiContentMessage[] } | null;
    assert(wire?.contents, "callGemini sent no contents");
    for (const content of wire.contents) {
      for (const part of content.parts) {
        assert(
          !hasFunctionCall(part),
          "an unsigned functionCall reached the wire — Gemini 3.x answers 400",
        );
        assert(
          !hasFunctionResponse(part),
          "a response whose call was downgraded reached the wire unpaired",
        );
      }
    }
    assertStringIncludes(JSON.stringify(wire.contents), "list_site_pages");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) Deno.env.delete("GEMINI_API_KEY_ARI");
    else Deno.env.set("GEMINI_API_KEY_ARI", originalKey);
  }
});

Deno.test("#3605 implementor: a signed pair is forwarded by callGemini verbatim", async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = Deno.env.get("GEMINI_API_KEY_ARI");
  Deno.env.set("GEMINI_API_KEY_ARI", "test-key-not-a-real-secret");
  let sentBody: { contents?: GeminiContentMessage[] } | null = null;

  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    sentBody = JSON.parse(String(init?.body ?? "{}"));
    return Promise.resolve(
      new Response(
        JSON.stringify({
          candidates: [{
            content: { parts: [{ text: "ok" }] },
            finishReason: "STOP",
          }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
  }) as unknown as typeof fetch;

  try {
    await callGemini({
      systemPrompt: "system",
      contents: [
        {
          role: "user",
          parts: [{ text: "<user_data>\nList pages\n</user_data>" }],
        },
        {
          role: "model",
          parts: [{
            functionCall: { name: "list_site_pages", args: { site_id: "s1" } },
            thoughtSignature: "SIG_FROM_THE_MODEL",
          }],
        },
        {
          role: "user",
          parts: [{
            functionResponse: {
              name: "list_site_pages",
              response: { result: { pages: ["home"] } },
            },
          }],
        },
      ],
      tools: [],
    });

    const wire = sentBody as { contents?: GeminiContentMessage[] } | null;
    assert(wire?.contents, "callGemini sent no contents");
    assert(
      hasFunctionCall(wire.contents[1].parts[0]),
      "a properly signed call must NOT be downgraded",
    );
    assert(
      hasFunctionResponse(wire.contents[2].parts[0]),
      "a properly paired response must NOT be downgraded",
    );
    assertStringIncludes(JSON.stringify(wire.contents), "SIG_FROM_THE_MODEL");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) Deno.env.delete("GEMINI_API_KEY_ARI");
    else Deno.env.set("GEMINI_API_KEY_ARI", originalKey);
  }
});

Deno.test("#3605 implementor: agent-chat echoes the model's own thought signature", () => {
  const source = Deno.readTextFileSync(
    new URL("../../agent-chat/index.ts", import.meta.url),
  );
  // The follow-up's echoed call is the ONE place the signature can be lost on
  // the happy path, because there the call is rebuilt by hand rather than
  // replayed. The wire assertions above prove the repair; this proves the
  // signature is carried at all, so the happy path stays a real function call
  // instead of degrading to text on every single read.
  assertStringIncludes(source, "gemini.toolCall.thoughtSignature");
});
