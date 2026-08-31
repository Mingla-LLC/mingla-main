// #1978 reopen — venue gallery adversarial fail-on-revert.
//
// Run:
//   deno test --allow-read supabase/functions/_shared/__tests__/issue_1978_ari_venue_gallery.tester_adversarial.test.ts

import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DOMAIN_TOOLS } from "../agentDomainTools.ts";
import { AGENT_TOOL_AUTHORIZATION } from "../agentToolAuthorization.ts";
import { isReadOnlyAgentToolCall } from "../agentTools.ts";
import { ToolError } from "../agentToolHelpers.ts";

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

function venueClient(captured: { name?: string; body?: Record<string, unknown> }) {
  return {
    from(table: string) {
      assertEquals(table, "venue_listings");
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
    },
    functions: {
      // deno-lint-ignore no-explicit-any
      invoke: (name: string, opts: any) => {
        captured.name = name;
        captured.body = opts?.body ?? {};
        return Promise.resolve({ data: { synced: true }, error: null });
      },
    },
  };
}

Deno.test("#1978 tester: auth floor stays event_manager/brand", () => {
  assertEquals(AGENT_TOOL_AUTHORIZATION.manage_venue_gallery, {
    requiredRole: "event_manager",
    resource: "brand",
  });
});

Deno.test("#1978 tester: sync is never treated as read-only", () => {
  assert(isReadOnlyAgentToolCall("manage_venue_gallery", { action: "get" }));
  assert(!isReadOnlyAgentToolCall("manage_venue_gallery", { action: "sync" }));
});

Deno.test("#1978 tester: sync without gallery_urls fails closed", async () => {
  const tool = domainTool("manage_venue_gallery");
  await assertRejects(
    () =>
      tool.executor(
        { brand_id: BRAND, venue_id: VENUE, action: "sync" },
        venueClient({}) as never,
        USER,
      ),
    ToolError,
  );
});

Deno.test("#1978 tester: sync forwards sync_gallery to authoring pipeline", async () => {
  const tool = domainTool("manage_venue_gallery");
  const captured: { name?: string; body?: Record<string, unknown> } = {};
  const result = await tool.executor(
    {
      brand_id: BRAND,
      venue_id: VENUE,
      action: "sync",
      gallery_urls: [" https://cdn.example/one.jpg ", "", "https://cdn.example/two.jpg"],
    },
    venueClient(captured) as never,
    USER,
  );
  assertEquals(captured.name, "run-business-place-authoring-pipeline");
  assertEquals(captured.body, {
    action: "sync_gallery",
    brand_id: BRAND,
    venue_id: VENUE,
    place_pool_id: PLACE,
    gallery_urls: [
      "https://cdn.example/one.jpg",
      "https://cdn.example/two.jpg",
    ],
  });
  assertEquals(result, { synced: true });
});

Deno.test("#1978 tester: unknown action fails before I/O side effects", async () => {
  const tool = domainTool("manage_venue_gallery");
  let invoked = false;
  await assertRejects(
    () =>
      tool.executor(
        { brand_id: BRAND, venue_id: VENUE, action: "upload" },
        {
          from: () => ({
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
          }),
          functions: {
            invoke: () => {
              invoked = true;
              return Promise.resolve({ data: {}, error: null });
            },
          },
        } as never,
        USER,
      ),
    ToolError,
  );
  assert(!invoked);
});
