import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { DOMAIN_READ_ONLY, DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { AGENT_TOOLS } from "../agentTools.ts";

// MINGLA-INVARIANT: I-3872-ARI-CANONICAL-WRITER | issue #3872 | Ari exposes the same Host discount and referral operations and never owns pricing or attribution math.
Deno.test(
  "#3872 Ari registry boots with the discount tools and exact roles",
  () => {
    const names = [
      "list_discounts",
      "create_discount",
      "pause_discount",
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
  },
);

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
