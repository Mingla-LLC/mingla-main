/**
 * #3660 — InvitePendingSheet Accept/Decline drives the tokenless edge path.
 * Source-contract style avoids pulling react-native-reanimated via Button.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const sheetSrc = readFileSync(
  join(__dirname, "../InvitePendingSheet.tsx"),
  "utf8",
);
const routeSrc = readFileSync(
  join(__dirname, "../../../../app/pending-brand-invite.tsx"),
  "utf8",
);

describe("InvitePendingSheet #3660", () => {
  test("Accept path calls useAcceptMyInvitation with invitationId", () => {
    expect(sheetSrc).toContain("useAcceptMyInvitation");
    expect(sheetSrc).toContain("await acceptAsync(invitationId)");
    expect(sheetSrc).toContain('onResolved?.("accepted", brandName)');
  });

  test("Decline path calls useDeclineMyInvitation with invitationId", () => {
    expect(sheetSrc).toContain("useDeclineMyInvitation");
    expect(sheetSrc).toContain("await declineAsync(invitationId)");
    expect(sheetSrc).toContain('onResolved?.("declined", brandName)');
  });

  test("pending-brand-invite route mounts InvitePendingSheet for a real invitationId", () => {
    expect(routeSrc).toContain("InvitePendingSheet");
    expect(routeSrc).toContain("invitationId");
    expect(routeSrc).toContain("pending-brand-invite-route");
  });

  test("pending-brand-invite resolves brandName from useMyPendingInvites, not the URL", () => {
    expect(routeSrc).toContain("useMyPendingInvites");
    expect(routeSrc).toContain("matchedInvite.brand_name");
    expect(routeSrc).not.toContain("params.brandName");
  });
});
