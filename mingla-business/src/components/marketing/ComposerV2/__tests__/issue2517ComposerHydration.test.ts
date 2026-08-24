/**
 * #2517 happy-path regression — a resumed draft must reach the editor.
 *
 * `initialContentHtml` is frozen at mount while `compose.tsx` hydrates a draft
 * asynchronously (`await getCampaign(draftId)`). Resume therefore mounted the
 * editor with an EMPTY snapshot, the preview filled in from parent state, and
 * the editor stayed blank forever — every saved draft opened uneditable.
 *
 * FAILS ON REVERT: delete the `shouldAdoptDraftBody` guard or its `useEffect`
 * caller in ComposerV2Editor.tsx and the wiring assertions below go red.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { shouldAdoptDraftBody } from "../composerHydration";

const SOURCE = readFileSync(
  join(__dirname, "..", "ComposerV2Editor.tsx"),
  "utf8",
);

describe("#2517 shouldAdoptDraftBody", () => {
  const ready = {
    alreadyHydrated: false,
    editorReady: true,
    incomingBodyHtml: "Draft body.",
    lastEmittedBodyHtml: "",
  };

  it("adopts the draft body that arrives after mount", () => {
    expect(shouldAdoptDraftBody(ready)).toBe(true);
  });

  it("never adopts twice", () => {
    expect(shouldAdoptDraftBody({ ...ready, alreadyHydrated: true })).toBe(false);
  });

  it("waits for the editor to initialise", () => {
    expect(shouldAdoptDraftBody({ ...ready, editorReady: false })).toBe(false);
  });

  it("does nothing for a genuinely blank new campaign", () => {
    expect(shouldAdoptDraftBody({ ...ready, incomingBodyHtml: "" })).toBe(false);
  });

  it("never overwrites words the operator already typed", () => {
    expect(
      shouldAdoptDraftBody({ ...ready, lastEmittedBodyHtml: "I started typing" }),
    ).toBe(false);
  });
});

describe("#2517 wiring", () => {
  it("routes the hydration effect through the guard", () => {
    expect(SOURCE).toContain("shouldAdoptDraftBody({");
    expect(SOURCE).toContain("richEditorRef.current?.setContentHTML(");
  });

  it("marks the editor ready from editorInitializedCallback", () => {
    expect(SOURCE).toContain("setEditorReady(true);");
  });

  it("records the last emitted body so live typing is detectable", () => {
    expect(SOURCE).toContain("lastEmittedRef.current = tokenString;");
  });

  it("does NOT remount the editor to hydrate — that clobbers the draft", () => {
    // The frozen-at-mount memo must stay frozen; adding initialBodyHtml to its
    // deps (or keying RichEditor) would remount pell and destroy live edits.
    expect(SOURCE).not.toContain("[initialBodyHtml]),");
    expect(SOURCE).not.toMatch(/<RichEditor[\s\S]{0,200}\bkey=/);
  });
});
