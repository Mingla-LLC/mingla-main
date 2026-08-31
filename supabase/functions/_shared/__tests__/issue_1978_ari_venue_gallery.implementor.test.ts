// #1978 reopen — venue gallery get/sync.
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1978_ari_venue_gallery.implementor.test.ts

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";
import { buildSystemPrompt, PROMPT_VERSION } from "../agentSystemPrompt.ts";

const BRAND = "11111111-1111-4111-8111-111111111111";
const VENUE = "22222222-2222-4222-8222-222222222222";
const PLACE = "33333333-3333-4333-8333-333333333333";
const USER = "44444444-4444-4444-8444-444444444444";

// deno-lint-ignore no-explicit-any
function domainTool(name: string): any {
  const tool = DOMAIN_TOOLS.find((t) => t.name === name);
  assert(tool, `${name} must be registered`);
  return tool;
}

function brandScopeClient(extra: Record<string, unknown> = {}) {
  const brandRow = {
    id: BRAND,
    name: "Gallery Brand",
    slug: "gallery-brand",
    default_currency: "usd",
    cover_media_url: null,
  };
  return {
    from(table: string) {
      if (table === "brands") {
        return {
          select: () => ({
            eq: () => ({
              is: () => Promise.resolve({ data: [brandRow], error: null }),
            }),
          }),
        };
      }
      if (table === "brand_team_members") {
        return {
          select: () => ({
            eq: () => ({
              not: () => ({
                is: () => ({
                  is: () => Promise.resolve({ data: [], error: null }),
                }),
              }),
            }),
          }),
        };
      }
      if (table === "venue_listings") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data: {
                      id: VENUE,
                      brand_id: BRAND,
                      place_pool_id: PLACE,
                    },
                    error: null,
                  }),
              }),
            }),
          }),
        };
      }
      if (table === "place_pool") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: PLACE,
                    business_gallery_urls: [
                      "https://cdn.example/a.jpg",
                      "https://cdn.example/b.jpg",
                    ],
                  },
                  error: null,
                }),
            }),
          }),
        };
      }
      if (extra[table]) return extra[table];
      throw new Error(`unexpected table ${table}`);
    },
  };
}

Deno.test("#1978 implementor: auth + read-only pins", () => {
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_venue_gallery, {
    requiredRole: "event_manager",
    resource: "brand",
  });
  assert(isReadOnlyAgentToolCall("manage_venue_gallery", { action: "get" }));
  assert(!isReadOnlyAgentToolCall("manage_venue_gallery", { action: "sync" }));
  assert(DOMAIN_TOOLS.some((t) => t.name === "manage_venue_gallery"));
});

Deno.test("#1978 implementor: PROMPT_VERSION advertises manage_venue_gallery", () => {
  assertEquals(PROMPT_VERSION, "v15");
  const prompt = buildSystemPrompt(null, [], { injectStrictReminder: false });
  assert(prompt.includes("manage_venue_gallery"));
});

Deno.test("#1978 implementor: get returns place_pool gallery urls", async () => {
  const tool = domainTool("manage_venue_gallery");
  const result = await tool.executor(
    { brand_id: BRAND, venue_id: VENUE, action: "get" },
    brandScopeClient() as never,
    USER,
  );
  assertEquals(result, {
    venue_id: VENUE,
    place_pool_id: PLACE,
    gallery_urls: [
      "https://cdn.example/a.jpg",
      "https://cdn.example/b.jpg",
    ],
    gallery_count: 2,
  });
});
