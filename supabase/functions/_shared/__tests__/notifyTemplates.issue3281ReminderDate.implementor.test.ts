// #3281 PR6 — buyer_event_reminder uses date_title / date_location overrides.
import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { renderCategoryMessage } from "../notifyTemplates.ts";

Deno.test("buyer_event_reminder 24h names override title and place", () => {
  const msg = renderCategoryMessage("buyer_event_reminder", {
    brand_name: "Mingla",
    event_title: "Rooftop Series",
    reserved_for: "2026-10-25T16:00:00.000Z",
    lead_bucket: "24h",
    date_title: "Halloween edition",
    date_location: "Okun Ajah Beach",
  });
  assertStringIncludes(msg.push.title, "Halloween edition");
  assertStringIncludes(msg.email.subject, "Halloween edition");
  assertStringIncludes(msg.email.body, "Okun Ajah Beach");
  assertStringIncludes(msg.sms, "Halloween edition");
});

Deno.test("buyer_event_reminder 2h falls back to event title without override", () => {
  const msg = renderCategoryMessage("buyer_event_reminder", {
    brand_name: "Mingla",
    event_title: "Rooftop Series",
    reserved_for: "2026-10-25T16:00:00.000Z",
    lead_bucket: "2h",
  });
  assertStringIncludes(msg.push.title, "Rooftop Series");
  assertStringIncludes(msg.email.subject, "Rooftop Series");
});
