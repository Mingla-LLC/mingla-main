/**
 * ORCH-0881 — create_experience tool registered with experience event_type write.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const TOOLS = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "supabase",
  "functions",
  "_shared",
  "agentTools.ts",
);

describe("create_experience tool contract", () => {
  const source = readFileSync(TOOLS, "utf8");

  test("registers create_experience and writes event_type experience live public", () => {
    expect(source).toMatch(/name:\s*"create_experience"/);
    expect(source).toMatch(/event_type:\s*"experience"/);
    expect(source).toMatch(/status:\s*"live"/);
    expect(source).toMatch(/visibility:\s*"public"/);
    expect(source).toMatch(/experience_meta/);
  });

  test("supports Play venue category with activities_snap and capacity fields", () => {
    expect(source).toMatch(/venueCategory !== "restaurant" && venueCategory !== "play"/);
    expect(source).toMatch(/activities_snap/);
    expect(source).toMatch(/capacity_min/);
    expect(source).toMatch(/suggested_time_of_day/);
    expect(source).toMatch(/filterPlayIntentTags/);
  });
});
