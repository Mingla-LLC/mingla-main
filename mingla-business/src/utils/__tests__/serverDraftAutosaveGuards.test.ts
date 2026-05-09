import { describe, expect, test } from "@jest/globals";

import type { DraftEvent } from "../../store/draftEventStore";
import {
  draftClientRevision,
  shouldApplyServerDraft,
  type DraftEditMeta,
} from "../serverDraftAutosaveGuards";

const draftWithRevision = (clientRevision?: number): DraftEvent =>
  ({
    id: "draft-1",
    clientRevision,
  }) as DraftEvent;

const editMeta = (
  clientRevision: number,
  dirty: boolean,
): DraftEditMeta => ({
  clientRevision,
  lastAcceptedServerRevision: clientRevision - 1,
  dirty,
});

describe("server draft autosave guards", () => {
  test("treats missing or invalid client revisions as zero", () => {
    expect(draftClientRevision(draftWithRevision(undefined))).toBe(0);
    expect(draftClientRevision(draftWithRevision(Number.NaN))).toBe(0);
    expect(draftClientRevision(draftWithRevision(4))).toBe(4);
  });

  test("rejects stale server responses behind the local draft revision", () => {
    expect(
      shouldApplyServerDraft({
        serverDraft: draftWithRevision(1),
        localDraft: draftWithRevision(2),
        editMeta: null,
      }),
    ).toBe(false);
  });

  test("rejects autosave echoes behind an actively dirty edit session", () => {
    expect(
      shouldApplyServerDraft({
        serverDraft: draftWithRevision(2),
        localDraft: draftWithRevision(1),
        editMeta: editMeta(3, true),
      }),
    ).toBe(false);
  });

  test("accepts current or newer server revisions", () => {
    expect(
      shouldApplyServerDraft({
        serverDraft: draftWithRevision(3),
        localDraft: draftWithRevision(2),
        editMeta: editMeta(3, true),
      }),
    ).toBe(true);
    expect(
      shouldApplyServerDraft({
        serverDraft: draftWithRevision(4),
        localDraft: draftWithRevision(3),
        editMeta: editMeta(3, false),
      }),
    ).toBe(true);
  });
});
