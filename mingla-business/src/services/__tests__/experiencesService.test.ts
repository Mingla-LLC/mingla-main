/**
 * ORCH-0881 — experiencesService queries event_type=experience only.
 */
import { describe, expect, test } from "@jest/globals";
import { readFileSync } from "fs";
import { join } from "path";

const SERVICE = join(__dirname, "..", "experiencesService.ts");

describe("experiencesService contract", () => {
  const source = readFileSync(SERVICE, "utf8");

  test("filters events by event_type experience", () => {
    expect(source).toMatch(/\.eq\("event_type",\s*"experience"\)/);
    expect(source).toMatch(/experience_meta/);
    expect(source).toMatch(/capacity_min/);
    expect(source).toMatch(/suggested_time_of_day/);
  });
});
