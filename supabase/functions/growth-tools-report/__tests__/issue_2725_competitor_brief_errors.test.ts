import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  BRAND_A,
  installStub,
  post,
  TOKEN_A,
  twoBrandWorld,
} from "../../growth-tools-run/__tests__/harness_1734.ts";
import { handler } from "../index.ts";

const WATCH_ID = "27252725-2725-4725-8725-272527252725";
const BRIEF_ID = "27252725-2725-4725-8725-272527252726";

for (const table of [
  "tool_competitor_sources",
  "tool_competitor_provider_capabilities",
  "tool_competitor_refresh_jobs",
  "tool_competitor_briefs",
]) {
  Deno.test(`issue 2725 competitor brief fails closed when ${table} read fails`, async () => {
    const stub = installStub({
      ...twoBrandWorld(),
      toolCompetitors: [{
        id: WATCH_ID,
        brand_id: BRAND_A,
        next_due_at: "2026-09-03T12:00:00Z",
        last_success_at: "2026-08-27T12:00:00Z",
        current_brief_id: BRIEF_ID,
      }],
    });
    const stubFetch = globalThis.fetch;
    globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      if (url.includes(`/rest/v1/${table}`)) {
        return Promise.resolve(new Response(JSON.stringify({ message: "forced read failure" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        }));
      }
      return stubFetch(input, init);
    };
    try {
      const response = await post(handler, {
        action: "competitor_brief",
        lane: "app",
        brand_id: BRAND_A,
        watch_id: WATCH_ID,
      }, TOKEN_A);
      assertEquals(response.status, 500);
      assertEquals(response.body, { error: "server" });
    } finally {
      stub.restore();
    }
  });
}
