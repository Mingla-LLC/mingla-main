import { readFileSync } from "node:fs";

const source = readFileSync(
  require.resolve("../PersonMaintenanceFlow"),
  "utf8",
);

describe("#1772 native maintenance footer hit targets", () => {
  test("keeps keyboard awareness only in the searchable picker", () => {
    expect(source.match(/<SmartScrollView\b/g) ?? []).toHaveLength(1);
    expect(source.match(/<\/SmartScrollView>/g) ?? []).toHaveLength(1);
    expect(source).toContain('keyboardShouldPersistTaps="handled"');
  });

  test("bounds both no-input review panes above their footer actions", () => {
    // [TEST-MOD-APPROVED #1772] The keyboard-aware native scroll view can
    // intercept sheet-footer touches when no keyboard input exists. Merge and
    // Split reviews must use bounded React Native scroll views instead.
    expect(source.match(/<NativeScrollView\b/g) ?? []).toHaveLength(2);
    expect(source.match(/<\/NativeScrollView>/g) ?? []).toHaveLength(2);
    expect(source.match(/style=\{styles\.reviewScroll\}/g) ?? []).toHaveLength(
      2,
    );
    expect(source).toContain("reviewScroll: { flex: 1 }");
  });
});
