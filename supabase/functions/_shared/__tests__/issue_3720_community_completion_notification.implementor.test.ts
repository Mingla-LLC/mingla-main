import {
  assertEquals,
  assertObjectMatch,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { providerSafePayload } from "../notifyV2.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";

Deno.test("#3720 Community reply has deterministic customer-safe copy", () => {
  const rendered = renderCategoryMessage("business.community_reply", {
    title: "private title must not render",
    body: "private message must not render",
  });
  assertEquals(rendered.push, {
    title: "New Community reply",
    body: "Someone replied to your Community post.",
  });
});

Deno.test("#3720 Community reply provider data contains ids, not authored content", () => {
  const safe = providerSafePayload("business.community_reply", {
    post_id: "37200000-0000-4000-8000-000000000777",
    comment_id: "37200000-0000-4000-8000-000000000778",
    title: "private title",
    body: "private reply",
    author: "private identity",
  });
  assertObjectMatch(safe, {
    post_id: "37200000-0000-4000-8000-000000000777",
    comment_id: "37200000-0000-4000-8000-000000000778",
  });
  assertEquals(Object.keys(safe).sort(), ["comment_id", "post_id"]);
});
