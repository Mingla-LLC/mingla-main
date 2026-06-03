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

  // META-ORCH-1059 — the list query selects the columns a proper offering-card
  // needs (cover media + price + when fields) and the mapper resolves a date
  // subline + price label. Reverting to the bare title/description select fails.
  test("selects cover + price + when columns for the Hub list card", () => {
    expect(source).toMatch(/cover_media_url/);
    expect(source).toMatch(/cover_media_type/);
    expect(source).toMatch(/whole_price_cents/);
    expect(source).toMatch(/is_recurring/);
    expect(source).toMatch(/is_multi_date/);
  });

  test("mapper resolves a dateSubline + priceLabel + cover media on each row", () => {
    expect(source).toMatch(/dateSubline/);
    expect(source).toMatch(/priceLabel/);
    expect(source).toMatch(/coverMediaUrl/);
    expect(source).toMatch(/experienceListSubline/);
  });
});
