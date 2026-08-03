import type { AcceptBrandInvitationResult } from "../../services/brandInvitationsService";
import { decideBankFirstInviteNext } from "../bankFirstPartnerInvite";

const baseResult: AcceptBrandInvitationResult = {
  brandId: "brand-948",
  role: "brand_owner",
  transferred: true,
  previousOwnerAccountId: "old-owner",
  newOwnerAccountId: "new-owner",
  brandSlug: "zuri-kitchen",
  newOwnerFirstName: "Amara",
  partnerSetup: true,
  countryCode: "GB",
  paymentProvider: "stripe",
  stripeChargesEnabled: false,
  stripePayoutsEnabled: false,
  paystackSubaccountCode: null,
};

describe("#948 W3 implementor — bank-first invite routing", () => {
  it.each([
    ["partner transfer without bank", {}, "connect"],
    ["partner no-transfer without bank", { transferred: false }, "connect"],
    [
      "partner whose bank is connected",
      { stripeChargesEnabled: true },
      "download",
    ],
    [
      "standard scanner/team invite",
      { partnerSetup: false, role: "scanner" as const },
      "inline",
    ],
  ])("%s → %s", (_name, patch, expectedKind) => {
    const decision = decideBankFirstInviteNext({ ...baseResult, ...patch });
    expect(decision.kind).toBe(expectedKind);
    if (expectedKind === "connect") {
      expect(decision).toEqual({
        kind: "connect",
        href: "/brand/brand-948/connect",
      });
    } else if (expectedKind === "download") {
      expect(decision).toEqual({ kind: "download" });
    }
  });
});
