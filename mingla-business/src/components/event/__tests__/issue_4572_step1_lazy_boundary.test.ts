/**
 * #4572 bundle movement — the Basics step (and the Event type picker #4572
 * grew) is shared by the Event wizard, the RSVP wizard and the published-event
 * editor. Imported directly by three route-only surfaces, Metro hoists it into
 * the eager `__common` chunk every public guest downloads (+3,116 B over the
 * 1,024 B movement threshold on PR #4586). All three must reach it through
 * the one lazy boundary.
 * FAILS-ON-REVERT: point any surface back at "./CreatorStep1Basics".
 */
import fs from "node:fs";
import path from "node:path";

const read = (rel: string): string => fs.readFileSync(path.resolve(__dirname, "..", "..", rel), "utf8");

describe("#4572 the Basics step stays behind one lazy boundary", () => {
  it.each([
    ["event/EventCreatorWizard.tsx", "./LazyCreatorStep1Basics"],
    ["event/EditPublishedScreen.tsx", "./LazyCreatorStep1Basics"],
    ["rsvp/RsvpCreatorWizard.tsx", "../event/LazyCreatorStep1Basics"],
  ])("%s imports the lazy wrapper, never the step itself", (file, wrapper) => {
    const src = read(file);
    expect(src).toContain(`import { CreatorStep1Basics } from "${wrapper}";`);
    expect(src).not.toMatch(/from "(\.\/|\.\.\/event\/)CreatorStep1Basics"/);
  });

  it("the wrapper loads the step only through a dynamic import", () => {
    const src = read("event/LazyCreatorStep1Basics.tsx");
    expect(src).toContain('await import("./CreatorStep1Basics")');
    expect(src).not.toMatch(/^import [^;]*from "\.\/CreatorStep1Basics";/m);
    expect(src).toContain("React.lazy(");
  });
});
