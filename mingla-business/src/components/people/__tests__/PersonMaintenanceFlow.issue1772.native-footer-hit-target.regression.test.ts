import { readFileSync } from "node:fs";

const source = readFileSync(
  require.resolve("../PersonMaintenanceFlow"),
  "utf8",
);

describe("#1772 native maintenance footer hit targets", () => {
  test("keeps keyboard awareness only in the searchable picker", () => {
    // [TEST-MOD-APPROVED #1772] Keep the canonical wrapper name pinned by the
    // #1772 Class A contract; only the no-input review panes use the alias.
    expect(source.match(/<ScrollView\b/g) ?? []).toHaveLength(1);
    expect(source.match(/<\/ScrollView>/g) ?? []).toHaveLength(1);
    expect(source).toContain('keyboardShouldPersistTaps="handled"');
  });

  test("bounds both no-input review panes above their footer actions", () => {
    // [TEST-MOD-APPROVED #1772] No-input review panes do not need keyboard
    // coordination. Bounding them independently keeps the footer outside the
    // review scroll surface on every native size.
    expect(source.match(/<ReviewScrollView\b/g) ?? []).toHaveLength(2);
    expect(source.match(/<\/ReviewScrollView>/g) ?? []).toHaveLength(2);
    expect(source.match(/style=\{styles\.reviewScroll\}/g) ?? []).toHaveLength(
      2,
    );
    expect(source).toContain("reviewScroll: { flex: 1 }");
  });
});
