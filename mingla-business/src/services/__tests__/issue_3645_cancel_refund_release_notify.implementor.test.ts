/**
 * #3645 item 6 — Host surfaces know about cancel-refund release notify.
 */

import {
  BUSINESS_NOTIFICATION_TEMPLATES,
  isBusinessNotificationType,
} from "../../constants/businessNotificationTemplates";
import { resolveBusinessNavTarget } from "../businessNotificationRouting";

describe("issue #3645 item 6 — cancel_refunds_released Host contract", () => {
  it("registers the type with refund-family inbox decoration", () => {
    expect(isBusinessNotificationType("business.cancel_refunds_released")).toBe(
      true,
    );
    const template =
      BUSINESS_NOTIFICATION_TEMPLATES["business.cancel_refunds_released"];
    expect(template.pushTitle).toBe("Refunds are on their way");
    expect(template.family).toBe("money");
    expect(template.masterCategory).toBe("orderActivity");
    expect(template.defaultPush).toBe(true);
    expect(/stripe|paystack/i.test(template.pushBody)).toBe(false);
  });

  it("routes the type to the offering event screen", () => {
    expect(
      resolveBusinessNavTarget({
        type: "business.cancel_refunds_released",
        eventId: "evt-1",
      }),
    ).toBe("/event/evt-1");
    expect(
      resolveBusinessNavTarget({
        type: "business.cancel_refunds_released",
        deepLink: "mingla-business://event/evt-2",
      }),
    ).toBe("/event/evt-2");
  });
});
