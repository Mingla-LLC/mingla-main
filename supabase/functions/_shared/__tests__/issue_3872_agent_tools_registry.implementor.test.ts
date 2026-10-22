import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

import { DOMAIN_READ_ONLY, DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { AGENT_TOOLS } from "../agentTools.ts";

// MINGLA-INVARIANT: I-3872-ARI-CANONICAL-WRITER | issue #3872 | Ari exposes the same three Host discount operations and never owns pricing math.
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
