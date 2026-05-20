/**
 * Ve6 — contract tests for activities parser modules (no Deno runtime required).
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const PARSER = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "supabase",
  "functions",
  "_shared",
  "geminiActivitiesParser.ts",
);

const EDGE = join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "supabase",
  "functions",
  "parse-play-activities",
  "index.ts",
);

describe("geminiActivitiesParser contract", () => {
  const parserSource = readFileSync(PARSER, "utf8");
  const edgeSource = readFileSync(EDGE, "utf8");

  test("exports normalize and parse with Play fields", () => {
    expect(parserSource).toMatch(/normalizeActivitiesParsePayload/);
    expect(parserSource).toMatch(/capacity_min/);
    expect(parserSource).toMatch(/suggested_time_of_day/);
    expect(parserSource).toMatch(/filterPlayIntentTags/);
  });

  test("parse-play-activities gates play verified physical brands", () => {
    expect(edgeSource).toMatch(/venue_category !== "play"/);
    expect(edgeSource).toMatch(/parseActivitiesWithGemini/);
    expect(edgeSource).toMatch(/SUPABASE_ANON_KEY/);
    expect(edgeSource).not.toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
  });
});
