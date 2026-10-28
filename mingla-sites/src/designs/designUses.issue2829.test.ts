/*
 * #2829 A8 — the design registry says which colour roles and font slots each
 * design draws (`uses`), and the look editors show only those. This pins the
 * registry to the design's stylesheet EXACTLY: a role the stylesheet reads but
 * the registry omits would hide a working control; a role the registry lists
 * but the stylesheet never reads would show a control that changes nothing.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { colorVar, DESIGN_OWNED_RGB_ROLES } from "../contracts/generated/tokens.ts";
import {
  DESIGN_KEYS,
  DESIGNS,
  designFontSlots,
  designSwatches,
} from "../contracts/generated/designs.ts";

const withoutComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const stylesheet = (key: string, version: number) =>
  withoutComments(fs.readFileSync(path.resolve(process.cwd(), "public/designs", key, `${version}.css`), "utf8"));

describe("#2829 A8 design `uses` matches the stylesheet", () => {
  for (const key of DESIGN_KEYS) {
    const design = DESIGNS[key];
    const css = stylesheet(key, design.version);

    it(`${key}: colour roles listed == colour properties read`, () => {
      const read = new Set([...css.matchAll(/var\((--c-[a-z0-9-]+)/g)].map((match) => match[1]!));
      for (const role of DESIGN_OWNED_RGB_ROLES) read.delete(colorVar(role));
      const listed = new Set<string>([
        ...design.uses.colors.single.map((role) => colorVar(role)),
        ...Object.entries(design.uses.colors.ramps).flatMap(([role, steps]) =>
          (steps ?? []).map((step) => colorVar(role, step))),
      ]);
      expect([...listed].sort()).toEqual([...read].sort());
    });

    it(`${key}: font slots listed == font properties read`, () => {
      const read = new Set([...css.matchAll(/var\(--font-(display|body|accent)\b/g)].map((match) => match[1]!));
      expect([...design.uses.font_slots].sort()).toEqual([...read].sort());
    });
  }

  it("atelier shows six swatches (no Headings, no Second accent) and two font slots", () => {
    expect(designSwatches(DESIGNS.atelier).map((swatch) => swatch.label)).toEqual([
      "Background",
      "Text",
      "Accent",
      "Accent label",
      "Dark panels",
      "Tinted bands",
    ]);
    expect(designFontSlots(DESIGNS.atelier)).toEqual(["display", "body"]);
  });
});
