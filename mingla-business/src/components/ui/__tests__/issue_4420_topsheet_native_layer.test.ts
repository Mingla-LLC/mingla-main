/**
 * #4420 native run (iOS 26, Fabric): the Create TopSheet's scrim painted UNDER
 * the Blast "Send a campaign" floating button. Fabric flattens layout-only
 * ancestors, so the button (zIndex 30) became a sibling of the overlay and
 * outranked it. The native overlay root now carries an explicit layer that
 * beats every in-screen floating control.
 */
import fs from "fs";
import path from "path";

const read = (rel: string): string =>
  fs.readFileSync(path.join(__dirname, rel), "utf8");

const zIndexIn = (block: string): number => {
  const m = block.match(/zIndex:\s*(\d+)/);
  return m ? Number(m[1]) : 0;
};

describe("#4420 TopSheet native overlay layer", () => {
  const src = read("../TopSheet.tsx");

  test("the native overlay root uses styles.nativeRoot (absolute fill + layer)", () => {
    expect(src).toContain("style={styles.nativeRoot}");
    const at = src.indexOf("nativeRoot: {");
    expect(at).toBeGreaterThan(0);
    const block = src.slice(at, src.indexOf("},", at));
    expect(block).toContain("...StyleSheet.absoluteFillObject");
    expect(block).toMatch(/elevation:\s*\d+/);
  });

  test("the overlay outranks the floating Blast action button", () => {
    const at = src.indexOf("nativeRoot: {");
    const overlay = zIndexIn(src.slice(at, src.indexOf("},", at)));
    const fab = read("../../marketing/MarketingActionButton.tsx");
    const fAt = fab.indexOf("floating: {");
    const fabZ = zIndexIn(fab.slice(fAt, fab.indexOf("},", fAt)));
    expect(fabZ).toBeGreaterThan(0);
    expect(overlay).toBeGreaterThan(fabZ);
  });
});

describe("#4420 Create sheet root options read in full", () => {
  test("root option subtitles carry no line clamp", () => {
    const src = read("../UniversalCreatorSheet.tsx");
    const at = src.indexOf('step === "root"');
    const block = src.slice(at, src.indexOf('step === "event"', at));
    expect(block).toContain("<Text style={styles.rowSubtitle}>");
    expect(block).not.toContain("numberOfLines");
  });
});

describe("#4420 Create sheet step titles share one casing", () => {
  test("the experience step title is sentence case like the event step", () => {
    const src = read("../UniversalCreatorSheet.tsx");
    expect(src).toContain("<Text style={styles.headerTitle}>Create an event</Text>");
    expect(src).toContain("<Text style={styles.headerTitle}>Create an experience</Text>");
    expect(src).not.toContain("Create An Experience");
  });
});
