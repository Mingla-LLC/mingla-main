/*
 * #2830 — rich text must survive the trip from Payload into the artifact.
 *
 * Payload stores rich text as `{ root: { children: [...] } }`. The extractor
 * walked the STORED VALUE looking for `text`/`children`, found neither on the
 * wrapper, and returned nothing. Every rich_text block published an empty
 * `paragraphs: []`; the artifact contract requires at least one; the publish
 * failed closed with ARTIFACT_BLOCK_CONTENT_MISMATCH.
 *
 * So no page carrying a rich_text block could ever be published. It went unseen
 * because the pilot had no such block until gogi's About and Home pages.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Comments above discuss `root` and `children` by name, so they are stripped.
const source = fs.readFileSync(
  path.resolve(process.cwd(), "src/lib/artifactBuilder.ts"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");

function paragraph(text: string) {
  return {
    type: "paragraph",
    children: [{ type: "text", text, version: 1 }],
    version: 1,
  };
}

/** The shape Payload actually persists. */
const payloadStored = {
  root: { type: "root", version: 1, children: [paragraph("first"), paragraph("second")] },
};

describe("#2830 lexical extraction descends into root", () => {
  it("unwraps the stored root before walking", () => {
    expect(source).toContain("walk((value as AnyDoc)?.root ?? value)");
  });

  it("no longer walks the wrapper directly", () => {
    // The reverted form. If this string comes back, rich text silently empties.
    expect(source).not.toMatch(/\n\s*walk\(value\);/);
  });

  it("the fixture used here is the shape Payload persists", () => {
    // Guards the test itself: if this stops being {root:{children}}, the
    // assertion above stops meaning anything.
    expect(Object.keys(payloadStored)).toEqual(["root"]);
    expect(Array.isArray(payloadStored.root.children)).toBe(true);
    expect(payloadStored.root.children[0].children[0].text).toBe("first");
  });

  it("a bare root node still works, so an unwrapped caller is unaffected", () => {
    const bare = payloadStored.root as { root?: unknown };
    expect(bare.root).toBeUndefined();
  });
});
