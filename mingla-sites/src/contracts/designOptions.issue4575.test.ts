/* eslint-disable @typescript-eslint/no-explicit-any -- this suite mutates untyped artifact JSON on purpose to prove each refusal. */
/*
 * #4575 — Grid design options (the full-screen cover and full-colour photos).
 *
 * The owner's stored value is checked by `assertDesignOptions`; what a
 * published artifact carries is `resolveDesignOptions` (only options the
 * design offers and that change the drawing; null when nothing does); and
 * `assertArtifactV2` refuses any `design.options` that is not exactly that.
 */
import { describe, expect, it } from "vitest";
import { assertArtifactV2 } from "./generated/artifactV2.ts";
import { assertDesignOptions, DESIGNS, GRID, resolveDesignOptions, type DesignKey } from "./generated/designs.ts";
import { galleryArtifact } from "../designs/shared/galleryDesigns.fixture";

describe("#4575 assertDesignOptions", () => {
  it("accepts nothing, nulls and every offered value", () => {
    for (const value of [null, undefined, {}, { cover: null, photos: null }, { cover: "full" }, { photos: "colour" }, { photos: "mono" }, { cover: "full", photos: "mono" }]) {
      expect(() => assertDesignOptions(value)).not.toThrow();
    }
  });

  it("refuses unknown keys, unknown values and non-objects", () => {
    expect(() => assertDesignOptions({ cover: "half" })).toThrow("DESIGN_OPTIONS_INVALID:cover");
    expect(() => assertDesignOptions({ photos: "sepia" })).toThrow("DESIGN_OPTIONS_INVALID:photos");
    expect(() => assertDesignOptions({ photos: 1 })).toThrow("DESIGN_OPTIONS_INVALID:photos");
    expect(() => assertDesignOptions({ ticker: "on" })).toThrow("DESIGN_OPTIONS_INVALID:ticker");
    expect(() => assertDesignOptions("full")).toThrow("DESIGN_OPTIONS_INVALID:design_options");
    expect(() => assertDesignOptions(["full"])).toThrow("DESIGN_OPTIONS_INVALID:design_options");
    expect(() => assertDesignOptions(7)).toThrow("DESIGN_OPTIONS_INVALID:design_options");
  });
});

describe("#4575 resolveDesignOptions (SC-4)", () => {
  it.each([
    [{ cover: "full" }, { cover: "full", photos: "colour" }],
    [{ cover: "full", photos: "mono" }, { cover: "full" }],
    [{ cover: "full", photos: "colour" }, { cover: "full", photos: "colour" }],
    [{ photos: "colour" }, { photos: "colour" }],
    [{ photos: "mono" }, null],
    [{ cover: null, photos: null }, null],
    [{}, null],
    [null, null],
    [undefined, null],
  ])("Grid with %j gives %j", (stored, expected) => {
    expect(resolveDesignOptions(GRID, stored)).toEqual(expected);
  });

  it("treats garbage as no options and never throws", () => {
    for (const garbage of ["full", 7, ["cover"], { cover: "half" }, { cover: "full", extra: true }]) {
      expect(resolveDesignOptions(GRID, garbage)).toBeNull();
    }
  });

  it("gives nothing on a design that offers no options", () => {
    for (const key of Object.keys(DESIGNS) as DesignKey[]) {
      if (key === "grid") continue;
      expect(DESIGNS[key].options).toBeUndefined();
      expect(resolveDesignOptions(DESIGNS[key], { cover: "full", photos: "colour" })).toBeNull();
    }
  });

  it("only Grid offers options and Grid stays version 1", () => {
    expect(GRID.options).toEqual(["cover", "photos"]);
    expect(GRID.version).toBe(1);
  });
});

describe("#4575 assertArtifactV2 design.options (SC-3)", () => {
  function withOptions(key: DesignKey, options: unknown): Record<string, unknown> {
    const artifact = structuredClone(galleryArtifact(key)) as any;
    artifact.design.options = options;
    return artifact;
  }

  it("still accepts a Grid artifact with no options", () => {
    const artifact = galleryArtifact("grid");
    expect(artifact.design).toEqual({ key: "grid", version: 1 });
    expect(() => assertArtifactV2(artifact)).not.toThrow();
  });

  it.each([[{ cover: "full" }], [{ photos: "colour" }], [{ cover: "full", photos: "colour" }]])("accepts %j on Grid", (options) => {
    expect(() => assertArtifactV2(withOptions("grid", options))).not.toThrow();
  });

  it.each(["atelier", "voyage", "terra"] as DesignKey[])("refuses options on %s", (key) => {
    expect(() => assertArtifactV2(withOptions(key, { cover: "full" }))).toThrow("ARTIFACT_DESIGN_MISMATCH");
    expect(() => assertArtifactV2(withOptions(key, { photos: "colour" }))).toThrow("ARTIFACT_DESIGN_MISMATCH");
  });

  it.each([
    ["empty", {}],
    ["an unknown key", { cover: "full", ticker: "on" }],
    ["cover half", { cover: "half" }],
    ["photos mono (never published)", { photos: "mono" }],
    ["a null value", { cover: null }],
    ["a non-object", "full"],
    ["an array", ["cover"]],
  ])("refuses %s on Grid", (_label, options) => {
    expect(() => assertArtifactV2(withOptions("grid", options))).toThrow("ARTIFACT_DESIGN_MISMATCH");
  });

  it("refuses any other key on design", () => {
    const artifact = structuredClone(galleryArtifact("grid")) as any;
    artifact.design.variant = "cover";
    expect(() => assertArtifactV2(artifact)).toThrow("ARTIFACT_DESIGN_MISMATCH");
  });
});
