import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { normalizeActivitiesParsePayload } from "./geminiActivitiesParser.ts";

Deno.test("normalizeActivitiesParsePayload caps at 20 experiences", () => {
  const raw = {
    experiences: Array.from({ length: 25 }, (_, i) => ({
      title: `Lane package ${i}`,
      narrative: `Narrative ${i}`,
      intent_tags: ["group_activity"],
    })),
  };
  const out = normalizeActivitiesParsePayload(raw);
  assertEquals(out.length, 20);
});

Deno.test("normalizeActivitiesParsePayload filters intent tags to Play allowlist", () => {
  const out = normalizeActivitiesParsePayload({
    experiences: [{
      title: "Arcade night",
      narrative: "Unlimited play",
      intent_tags: ["brunch", "friends_chill", "group_activity"],
    }],
  });
  assertEquals(out.length, 1);
  assertEquals(out[0].intent_tags, ["friends_chill", "group_activity"]);
});

Deno.test("normalizeActivitiesParsePayload keeps capacity and time fields", () => {
  const out = normalizeActivitiesParsePayload({
    experiences: [{
      title: "Escape room",
      narrative: "1 hour, up to 8 guests",
      capacity_min: 8,
      capacity_max: 2,
      suggested_time_of_day: "Friday evening",
      intent_tags: ["group_activity"],
    }],
  });
  assertEquals(out[0].capacity_min, 2);
  assertEquals(out[0].capacity_max, 8);
  assertEquals(out[0].suggested_time_of_day, "Friday evening");
});

Deno.test("normalizeActivitiesParsePayload returns empty for invalid shape", () => {
  assertEquals(normalizeActivitiesParsePayload(null), []);
  assertEquals(normalizeActivitiesParsePayload({}), []);
});
