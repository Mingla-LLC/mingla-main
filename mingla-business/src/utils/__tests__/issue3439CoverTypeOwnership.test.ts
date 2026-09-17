import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@jest/globals";
import type { DraftEvent } from "../../store/draftEventStore";
import type { ServerDraftCover } from "../draftCoverBase";

// The store consumes cover-base bookkeeping. Its low-level helper must not
// depend back on the store, even for types (the module-cycle gate includes them).
// Pin the actual field contract as well: breaking the cycle must not widen it.
type RequiredDraftCover = {
  [K in keyof ServerDraftCover]-?: Exclude<DraftEvent[K], undefined>;
};
type SameCoverContract =
  ServerDraftCover extends RequiredDraftCover
    ? RequiredDraftCover extends ServerDraftCover ? true : false
    : false;
const sameCoverContract: SameCoverContract = true;

describe("#3439 cover bookkeeping has a lower-level type owner", () => {
  test("the server cover exactly matches the draft cover fields", () => {
    expect(sameCoverContract).toBe(true);
  });

  test("the bookkeeping helper has no import edge back to the store", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/utils/draftCoverBase.ts"), "utf8",
    );
    expect(source).not.toMatch(/from\s+["'][^"']*store\/draftEventStore["']/);
    expect(source).toMatch(/import type \{ EventCoverMediaType \} from "@mingla\/offering-rendering"/);
    expect(source).toMatch(/import type \{ EventCoverMediaProvider \} from "\.\.\/types\/eventCoverProvider"/);
  });
});
