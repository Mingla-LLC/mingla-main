import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { DOMAIN_READ_ONLY, DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { AGENT_TOOLS, isReadOnlyAgentToolCall } from "../agentTools.ts";
import { buildSystemPrompt } from "../agentSystemPrompt.ts";

// MINGLA-INVARIANT: I-3872-ARI-CANONICAL-WRITER | issue #3872 | Ari exposes the same Host discount and referral operations and never owns pricing or attribution math.
Deno.test(
  "#3872 Ari registry boots with the discount tools and exact roles",
  () => {
    const names = [
      "list_discounts",
      "create_discount",
      "pause_discount",
      "resume_discount",
      "end_discount",
    ] as const;
    for (const name of names) {
      assert(
        DOMAIN_TOOLS.some((tool) => tool.name === name),
        `${name} domain registration`,
      );
      assert(
        AGENT_TOOLS.some((tool) => tool.name === name),
        `${name} secure registration`,
      );
      assertEquals(AGENT_TOOL_AUTHORIZATION[name], {
        requiredRole: "marketing_manager",
        resource: "brand",
      });
    }
    assert(DOMAIN_READ_ONLY.has("list_discounts"));
    assert(!DOMAIN_READ_ONLY.has("create_discount"));
    assert(!DOMAIN_READ_ONLY.has("pause_discount"));
    assert(!DOMAIN_READ_ONLY.has("resume_discount"));
    assert(!DOMAIN_READ_ONLY.has("end_discount"));
  },
);

// #4304 — production 2026-11-08: a Host asked Ari to "End the DEMO20 discount
// code" and Ari could only list records, because it had no end tool. End and
// resume now mirror pause: a confirmed, versioned call to the Host writer.
const BRAND = "6f7d1c52-0d4e-4a43-9a0e-1f6b7f2a9b10";
const DISCOUNT = "0b8e2f4a-9c1d-4e7f-8a2b-3c4d5e6f7a80";

function recordingClient(): {
  client: unknown;
  calls: Array<{ name: string; body: unknown }>;
} {
  const calls: Array<{ name: string; body: unknown }> = [];
  return {
    calls,
    client: {
      functions: {
        invoke: (name: string, init: { body: unknown }) => {
          calls.push({ name, body: init.body });
          return Promise.resolve({ data: { discount: {} }, error: null });
        },
      },
    },
  };
}

for (
  const [name, action] of [
    ["pause_discount", "pause"],
    ["resume_discount", "resume"],
    ["end_discount", "end"],
  ] as const
) {
  Deno.test(`#4304 ${name} is a confirmed, versioned ${action} request`, async () => {
    const tool = DOMAIN_TOOLS.find((candidate) => candidate.name === name);
    assert(tool, `${name} registered`);
    const schema = tool.parameters as {
      properties: Record<string, unknown>;
      required: string[];
    };
    assertEquals(schema.required, ["brand_id", "discount_id", "version"]);
    assertEquals(Object.keys(schema.properties).sort(), [
      "brand_id",
      "discount_id",
      "version",
    ]);
    // Runs only after the Host confirms the proposal card.
    assert(
      !isReadOnlyAgentToolCall(name, {
        brand_id: BRAND,
        discount_id: DISCOUNT,
        version: 3,
      }),
    );

    const { client, calls } = recordingClient();
    // deno-lint-ignore no-explicit-any
    await tool.executor(
      { brand_id: BRAND, discount_id: DISCOUNT, version: 3 },
      client as any,
      "user-1",
      // deno-lint-ignore no-explicit-any
      {} as any,
    );
    assertEquals(calls, [{
      name: "brand-discount-upsert",
      body: {
        action,
        payload: { id: DISCOUNT, brandId: BRAND, version: 3, source: "ari" },
      },
    }]);
  });
}

Deno.test("#4304 the prompt tells Ari to look a named discount up, then propose", () => {
  const prompt = buildSystemPrompt(null, [], { injectStrictReminder: false });
  assert(prompt.includes("- end_discount — "));
  assert(prompt.includes("- resume_discount — "));
  assert(
    prompt.includes(
      "To end, pause or resume a discount the Host names by its code, first call list_discounts",
    ),
  );
  assert(prompt.includes("to get its discount_id and version, then propose"));
  assert(prompt.includes("Never just list the discounts and stop."));
});

Deno.test("#3872 R2/R3 Ari registry uses canonical referral and script operations", () => {
  const names = [
    "list_referral_offers",
    "create_referral_offer",
    "invite_promoters",
    "draft_gig_script",
  ] as const;
  for (const name of names) {
    assert(
      DOMAIN_TOOLS.some((tool) => tool.name === name),
      `${name} domain registration`,
    );
    assert(
      AGENT_TOOLS.some((tool) => tool.name === name),
      `${name} secure registration`,
    );
    assertEquals(AGENT_TOOL_AUTHORIZATION[name], {
      requiredRole: "marketing_manager",
      resource: "brand",
    });
  }
  assert(DOMAIN_READ_ONLY.has("list_referral_offers"));
  assert(DOMAIN_READ_ONLY.has("draft_gig_script"));
  assert(!DOMAIN_READ_ONLY.has("create_referral_offer"));
  assert(!DOMAIN_READ_ONLY.has("invite_promoters"));
});

Deno.test(
  "#3872 create proposal shows every permitted combination choice",
  () => {
    const tool = DOMAIN_TOOLS.find(
      (candidate) => candidate.name === "create_discount",
    );
    assert(tool);
    const schema = tool.parameters as {
      properties: Record<string, { enum?: string[] }>;
      required: string[];
    };
    assertEquals(schema.properties.combines_with.enum, [
      "none",
      "automatic_only",
      "any",
    ]);
    assert(schema.required.includes("brand_id"));
    assert(schema.required.includes("kind"));
    assert(schema.required.includes("targets"));
  },
);
