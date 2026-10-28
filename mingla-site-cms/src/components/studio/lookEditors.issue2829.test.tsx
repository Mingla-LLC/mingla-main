/*
 * #2829 A8 — Studio's look editors show only the colour swatches and font
 * slots the chosen design draws (registry `uses`, packages/site-contracts),
 * and hiding a control never drops the value stored for it.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ATELIER, designSwatches, type DesignDefinition } from "../../contracts/generated/designs.ts";

const form = vi.hoisted(() => ({ value: undefined as unknown, design: "atelier" as unknown, setValue: vi.fn() }));
vi.mock("@payloadcms/ui", () => ({
  useField: () => ({ value: form.value, setValue: form.setValue }),
  useFormFields: (select: (state: [Record<string, { value: unknown }>]) => unknown) =>
    select([{ design: { value: form.design } }]),
}));

const { default: TokenEditor } = await import("./TokenEditor");
const { default: FontPicker } = await import("./FontPicker");
const { allColoursFor, fontSlotsFor, resolvedLook, swatchesFor, swatchValue } = await import("./lookModel");

const labels = (html: string) => [...html.matchAll(/<label for="swatch-[^"]+"[^>]*>([^<]+)<\/label>/g)].map((m) => m[1]);
const legends = (html: string) => [...html.matchAll(/<legend>([^<]+)<\/legend>/g)].map((m) => m[1]);

beforeEach(() => {
  form.value = undefined;
  form.design = "atelier";
  form.setValue.mockReset();
});

describe("#2829 A8 Studio colour editor", () => {
  it("atelier shows its six swatches, not Headings or Second accent", () => {
    const html = renderToStaticMarkup(<TokenEditor path="tokens" />);
    expect(labels(html)).toEqual(["Background", "Text", "Accent", "Accent label", "Dark panels", "Tinted bands"]);
    expect(html).not.toContain(">Headings<");
    expect(html).not.toContain(">Second accent<");
  });

  it("the swatch set is whatever the design draws (a design drawing every primary role shows all eight)", () => {
    const everything: DesignDefinition = {
      ...ATELIER,
      uses: {
        colors: {
          single: ["canvas", "ink_body", "ink_strong", "accent_ink", "surface_deep", "surface_sunken"],
          ramps: { accent: [400], highlight: [600] },
        },
        font_slots: ["display", "body", "accent"],
      },
    };
    expect(designSwatches(everything).map((swatch) => swatch.label)).toEqual([
      "Background", "Text", "Headings", "Accent", "Accent label", "Second accent", "Dark panels", "Tinted bands",
    ]);
    expect(swatchesFor("atelier").map((swatch) => swatch.label)).toEqual(designSwatches(ATELIER).map((s) => s.label));
  });

  it("'All colours' lists only roles atelier draws", () => {
    const all = allColoursFor("atelier").map((swatch) => `${swatch.role}${swatch.step ?? ""}`);
    expect(all).toContain("canvas");
    expect(all).toContain("accent400");
    expect(all).not.toContain("ink_strong");
    expect(all).not.toContain("highlight600");
    expect(all).not.toContain("paper100");
  });

  it("a stored value for a hidden role is kept and still resolves", () => {
    const stored = { colors: { ink_strong: "#123456", highlight: { seed: "#abcdef", steps: { 600: "#abcdef" } } } };
    form.value = structuredClone(stored);
    renderToStaticMarkup(<TokenEditor path="tokens" />);
    expect(form.setValue).not.toHaveBeenCalled();
    expect(form.value).toEqual(stored);
    const tokens = resolvedLook("atelier", stored);
    expect(swatchValue(tokens, { label: "Headings", role: "ink_strong" })).toBe("#123456");
    expect(swatchValue(tokens, { label: "Second accent", role: "highlight", step: 600 })).toBe("#abcdef");
  });
});

describe("#2829 A8 Studio font picker", () => {
  it("atelier shows Headings and Body text only, no accent script slot", () => {
    const html = renderToStaticMarkup(<FontPicker path="fonts" />);
    expect(legends(html)).toEqual(["Headings", "Body text"]);
    expect(fontSlotsFor("atelier")).toEqual(["display", "body"]);
  });

  it("a stored accent font is kept even though atelier hides the slot", () => {
    form.value = { accent: { family: "Caveat", source: "google" } };
    renderToStaticMarkup(<FontPicker path="fonts" />);
    expect(form.setValue).not.toHaveBeenCalled();
    expect(form.value).toEqual({ accent: { family: "Caveat", source: "google" } });
  });
});
