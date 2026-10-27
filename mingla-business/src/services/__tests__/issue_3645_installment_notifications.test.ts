import { BUSINESS_NOTIFICATION_TEMPLATES } from "../../constants/businessNotificationTemplates";
import { resolveBusinessNavTarget } from "../businessNotificationRouting";

describe("#3645 host installment notifications", () => {
  it("keeps failed and at-risk events in the payments preference bucket", () => {
    const failed = BUSINESS_NOTIFICATION_TEMPLATES["business.installment_failed"];
    const atRisk = BUSINESS_NOTIFICATION_TEMPLATES["business.installment_at_risk"];
    expect(failed.masterCategory).toBe("paymentsTrust");
    expect(atRisk.masterCategory).toBe("paymentsTrust");
    expect(failed.defaultPush && failed.defaultInApp).toBe(true);
    expect(atRisk.pushBody).toContain("Review it in Trip Money.");
  });

  it("routes both notification types to the affected trip's Money surface", () => {
    for (const type of [
      "business.installment_failed",
      "business.installment_at_risk",
    ] as const) {
      expect(resolveBusinessNavTarget({ type, eventId: "trip-3645" })).toBe(
        "/trip/trip-3645/money",
      );
    }
  });
});
