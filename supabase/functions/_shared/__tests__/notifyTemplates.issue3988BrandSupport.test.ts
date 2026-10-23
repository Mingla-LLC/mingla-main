import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";

Deno.test("#3988 brand support opening and ownership use host-facing copy", () => {
  const opened = renderCategoryMessage("business.support_new_ticket", {
    audience: "brand",
    update_kind: "opened",
    subject: "Foodie Fantasy sharing",
  });
  assertEquals(opened.push.title, "Support case opened");
  assertStringIncludes(opened.push.body, "opened and took ownership");

  const owned = renderCategoryMessage("business.support_new_ticket", {
    audience: "brand",
    update_kind: "owned",
    subject: "Foodie Fantasy sharing",
  });
  assertStringIncludes(owned.push.body, "taken ownership");
});
