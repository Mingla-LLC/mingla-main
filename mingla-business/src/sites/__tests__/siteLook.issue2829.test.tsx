/*
 * #2829 W3 (SC-13, exit 4 Business half) — the look model: any colour is
 * stored exactly, readability warnings appear for ink_body #bbbbbb on a white
 * background and never block saving, and nothing auto-corrects a colour.
 * (#2829 W9r: the screen half moved to the Website design section; see
 * components/sites/website/__tests__/websiteBehaviours + websiteSections.)
 */
import {
  designOfSettings,
  fontWarningMessage,
  LOOK_SWATCHES,
  lookWarningRows,
  resolveLook,
  restoreColours,
  setSwatch,
  slotFamily,
  swatchHex,
} from "../siteLook";

const design = designOfSettings({ design: "atelier" });
const lowContrast = setSwatch(setSwatch({}, LOOK_SWATCHES[0]!, "#ffffff")!, LOOK_SWATCHES[1]!, "bbbbbb")!;

describe("#2829 Your look model", () => {
  it("stores exactly what the owner typed; refuses anything that is not a 6-digit hex", () => {
    expect(lowContrast.colors).toEqual({ canvas: "#ffffff", ink_body: "#bbbbbb" });
    const accent = setSwatch({}, LOOK_SWATCHES[3]!, "#FF00AA")!;
    expect(accent.colors).toEqual({ accent: { seed: "#ff00aa", steps: { 400: "#ff00aa" } } });
    expect(swatchHex(resolveLook(design, accent), LOOK_SWATCHES[3]!)).toBe("#ff00aa");
    expect(setSwatch({}, LOOK_SWATCHES[0]!, "red")).toBeNull();
    expect(setSwatch({}, LOOK_SWATCHES[0]!, "#fff")).toBeNull();
  });

  it("warns for #bbbbbb text on white in plain words, and the colour stays #bbbbbb", () => {
    const resolved = resolveLook(design, lowContrast);
    const rows = lookWarningRows(resolved);
    expect(rows[0]).toEqual({
      pair: "body_on_canvas",
      sentence: "Body text on your page background is hard to read (1.9:1; aim for 4.5:1).",
      suggestion: expect.stringMatching(/^#[0-9a-f]{6}$/),
    });
    expect(resolved.colors.ink_body).toBe("#bbbbbb");
  });

  it("restores the design's colours, and names the design's fonts until the owner picks one", () => {
    expect(restoreColours({ ...lowContrast, radius: "soft" })).toEqual({ radius: "soft" });
    expect(slotFamily(design, {}, "display")).toBe("Oswald");
    expect(slotFamily(design, { display: { family: "Fraunces", source: "google" } }, "display")).toBe("Fraunces");
    expect(fontWarningMessage({ slot: "display", used: "Oswald" })).toBe("Your heading font couldn’t be loaded, we used Oswald for now.");
  });

  it("a value stored for a role the design does not draw is kept and still resolves", () => {
    const stored = setSwatch({}, { label: "Headings", role: "ink_strong" }, "#123456")!;
    expect(stored.colors).toEqual({ ink_strong: "#123456" });
    expect(resolveLook(design, stored).colors.ink_strong).toBe("#123456");
  });
});
