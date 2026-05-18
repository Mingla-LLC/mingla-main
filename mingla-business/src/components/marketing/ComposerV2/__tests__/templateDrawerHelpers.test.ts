/**
 * ORCH-0864 [Marketing Composer V2] Stage E — TemplatePreviewDrawer
 * pure-helper tests. Component-render tests (swiper navigation, Apply
 * confirmation dialog, responsive tablet-vs-phone layout) exercise
 * end-to-end via Stage G Maestro flows + Stage H live-fire.
 */

import {
  sortTemplatesStarterFirst,
  substituteOnce,
} from "../templateDrawerHelpers";
import type { MarketingTemplateRow } from "../../../../types/marketing";

const baseRow = (
  override: Partial<MarketingTemplateRow>,
): MarketingTemplateRow => ({
  id: override.id ?? "id",
  account_id: null,
  brand_id: null,
  name: override.name ?? "Untitled",
  channel: "email",
  subject_template: null,
  body_template: "",
  is_starter_pack: override.is_starter_pack ?? false,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
});

describe("sortTemplatesStarterFirst", () => {
  it("groups starters before user templates", () => {
    const out = sortTemplatesStarterFirst([
      baseRow({ id: "u1", name: "Apple", is_starter_pack: false }),
      baseRow({ id: "s1", name: "Zebra", is_starter_pack: true }),
      baseRow({ id: "u2", name: "Banana", is_starter_pack: false }),
      baseRow({ id: "s2", name: "Antelope", is_starter_pack: true }),
    ]);
    expect(out.map((t) => t.id)).toEqual(["s2", "s1", "u1", "u2"]);
  });

  it("sorts within each group alphabetically by name", () => {
    const out = sortTemplatesStarterFirst([
      baseRow({ id: "c", name: "Charlie", is_starter_pack: false }),
      baseRow({ id: "a", name: "Alpha", is_starter_pack: false }),
      baseRow({ id: "b", name: "Bravo", is_starter_pack: false }),
    ]);
    expect(out.map((t) => t.name)).toEqual(["Alpha", "Bravo", "Charlie"]);
  });

  it("returns a new array (does not mutate input)", () => {
    const input = [
      baseRow({ id: "u", name: "User", is_starter_pack: false }),
      baseRow({ id: "s", name: "Starter", is_starter_pack: true }),
    ];
    const snapshot = input.map((t) => t.id);
    sortTemplatesStarterFirst(input);
    expect(input.map((t) => t.id)).toEqual(snapshot);
  });

  it("handles empty list", () => {
    expect(sortTemplatesStarterFirst([])).toEqual([]);
  });
});

describe("substituteOnce — preview-side token substitution", () => {
  it("replaces every known token with its value", () => {
    const out = substituteOnce(
      "Hi {first_name}, {event_name} on {event_date}.",
      { first_name: "Sarah", event_name: "Sunset Mixer", event_date: "Sat Jun 7" },
    );
    expect(out).toBe("Hi Sarah, Sunset Mixer on Sat Jun 7.");
  });

  it("leaves unknown brace expressions as literal text (Constitution #9)", () => {
    const out = substituteOnce(
      "Hi {first_name}, ref {something_else}",
      { first_name: "Sarah" },
    );
    expect(out).toBe("Hi Sarah, ref {something_else}");
  });

  it("leaves the token literal when value is null/undefined (don't fabricate)", () => {
    expect(substituteOnce("Hi {first_name}", { first_name: null })).toBe("Hi {first_name}");
    expect(substituteOnce("Hi {first_name}", {})).toBe("Hi {first_name}");
  });

  it("does not touch event embed tokens — {{event:uuid}} stays as-is", () => {
    const input = "See ya at {{event:abc-123}} with {first_name}";
    const out = substituteOnce(input, { first_name: "Sarah" });
    // Single-brace personalization is substituted; double-brace event token
    // is rendered separately by previewBlocks().
    expect(out).toBe("See ya at {{event:abc-123}} with Sarah");
  });
});
