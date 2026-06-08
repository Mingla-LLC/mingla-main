import fs from "node:fs";
import path from "node:path";

/**
 * ORCH-1103 REWORK 3 — create-and-attach lifecycle is airtight.
 *
 * Reproduced on device: after "Create & attach" mints the brand, the original
 * CREATE BRAND proposal card stayed mounted with its primary Confirm button
 * ACTIVE → tapping it re-confirmed the now-EXECUTED pending action → red toast
 * "Cannot confirm — current status: executed". The resolved receipt AND the
 * still-live card both rendered (double representation), and the attached video
 * cover never reached the receipt (slug only).
 *
 * This test locks the four guarantees of the fix:
 *   1. POST-COMMIT the card exposes NO re-confirm of the executed action — the
 *      `committed` branch replaces Confirm/Edit/Cancel with a single "Done".
 *   2. The host suppresses the executed receipt while its pending action is
 *      still live (mutual exclusion: card OR receipt, never both).
 *   3. The attached cover is threaded commit → host → receipt (attachedCovers),
 *      so the receipt shows the real cover the executed row doesn't carry.
 *   4. An already-executed / expired / raced confirm is a silent no-op in the
 *      screen (isAlreadyResolvedError), never the alarming red error toast.
 *
 * Follows the established mingla-business ARI CI pattern (ts-jest, node env,
 * SOURCE-assertion — same as orch_1103_ari_brand_crud_ui / orch_1101_*). The
 * lifecycle is encoded in static control-flow structure; reverting any of the
 * four fixes flips its assertion(s) red (fails-on-revert).
 */

const ROOT = path.resolve(__dirname, "../../../..");
function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

const proposalCard = read("src/components/ari/ToolProposalCard.tsx");
const messageList = read("src/components/ari/MessageList.tsx");
const screen = read("src/screens/ari/AriChatScreen.tsx");

describe("ORCH-1103 REWORK 3 — fix #1: no re-confirm of the executed action post-commit", () => {
  it("derives a `committed` flag from createdBrandId (brand minted via Create & attach)", () => {
    expect(proposalCard).toMatch(/const\s+committed\s*=\s*createdBrandId\s*!==\s*null/);
  });

  it("gates the action row on `committed` — committed state renders its own branch", () => {
    expect(proposalCard).toMatch(/\{committed\s*\?\s*\(/);
  });

  it("the committed branch's only action is Done (no Confirm/Edit/Cancel re-touch)", () => {
    // The committed branch must wire onPress to the finish handler, not onConfirm.
    expect(proposalCard).toMatch(/onPress=\{handleDone\}/);
    expect(proposalCard).toContain('accessibilityLabel="Done"');
  });

  it("handleDone resolves via onAttachDone — it never calls onConfirm", () => {
    const handleDone = proposalCard.slice(
      proposalCard.indexOf("const handleDone"),
      proposalCard.indexOf("const confirmDisabled"),
    );
    expect(handleDone).toContain("onAttachDone");
    expect(handleDone).not.toContain("onConfirm");
  });
});

describe("ORCH-1103 REWORK 3 — fix #2: card and receipt are mutually exclusive", () => {
  it("MessageList suppresses the executed tool_result while its pending action is live", () => {
    // The raw-build loop must skip the tool row whose tool_results.pending_action_id
    // matches the still-live pendingAction (the live card owns the representation).
    expect(messageList).toMatch(
      /pendingAction\s*&&[\s\S]*?pending_action_id\s*===\s*pendingAction\.pending_action_id[\s\S]*?continue/,
    );
  });
});

describe("ORCH-1103 REWORK 3 — fix #3: attached cover reaches the receipt", () => {
  it("onAttachDone carries the attached cover { url, type }", () => {
    expect(proposalCard).toMatch(/onAttachDone\?:\s*\(cover\?:\s*\{\s*url:\s*string\s*\|\s*null;\s*type:\s*string\s*\|\s*null\s*\}\)/);
  });

  it("the card passes the live editedArgs cover up on finish", () => {
    expect(proposalCard).toMatch(/const\s+finishCover\s*=\s*\(\)/);
    expect(proposalCard).toContain("cover_media_url");
  });

  it("the screen stashes the attached cover keyed by pending_action_id", () => {
    expect(screen).toMatch(/attachedCovers/);
    expect(screen).toMatch(/setAttachedCovers/);
  });

  it("the receipt overlays the attached cover onto the executed (null-cover) row", () => {
    expect(messageList).toMatch(/attachedCovers\[tr\.pending_action_id/);
    expect(messageList).toMatch(/cover_media_url:\s*rawBrand\.cover_media_url\s*\?\?\s*attached\?\.url/);
  });
});

describe("ORCH-1103 REWORK 3 — fix #4: already-executed confirm is a soft no-op", () => {
  it("the screen recognises the WRONG_STATE / race phrasings", () => {
    expect(screen).toMatch(/function\s+isAlreadyResolvedError/);
    expect(screen).toContain("current status:");
    expect(screen).toContain("already handled");
  });

  it("an already-resolved confirm clears the card without the red error toast", () => {
    const handleConfirm = screen.slice(
      screen.indexOf("const handleConfirm"),
      screen.indexOf("const handleCancelProposal"),
    );
    expect(handleConfirm).toMatch(/isAlreadyResolvedError\(result\.message\)/);
    // The no-op branch clears the pending action and returns BEFORE setLocalError.
    const guardIdx = handleConfirm.indexOf("isAlreadyResolvedError(result.message)");
    const setErrIdx = handleConfirm.indexOf("setLocalError(result.message)");
    expect(guardIdx).toBeGreaterThan(-1);
    expect(setErrIdx).toBeGreaterThan(guardIdx);
    expect(handleConfirm.slice(guardIdx, setErrIdx)).toContain("chat.clearPendingAction()");
  });
});
