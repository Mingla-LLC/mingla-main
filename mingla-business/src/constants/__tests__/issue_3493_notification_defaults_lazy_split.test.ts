/**
 * #3493 — keep the full notification copy catalog out of the eager shared
 * chunk while preserving the exact preference defaults it owns.
 */

// MINGLA-INVARIANT: I-3493-NOTIFICATION-COPY-STAYS-LAZY | issue #3493 | Startup notification preference defaults stay aligned with the full notification catalog without importing that copy matrix into the settings hook.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  BUSINESS_NOTIFICATION_TEMPLATES,
  type BusinessNotificationType,
} from "../businessNotificationTemplates";
import { businessNotificationDefaultOptIn } from "../businessNotificationPreferenceDefaults";

describe("#3493 notification preference split", () => {
  test("the startup-safe rule matches every full-catalog default", () => {
    for (const template of Object.values(BUSINESS_NOTIFICATION_TEMPLATES)) {
      expect(businessNotificationDefaultOptIn(template.type, "push")).toBe(
        template.defaultPush,
      );
      expect(businessNotificationDefaultOptIn(template.type, "in_app")).toBe(
        template.defaultInApp,
      );
    }
  });

  test("the settings hook does not runtime-import the full copy catalog", () => {
    const source = readFileSync(
      resolve(__dirname, "../../hooks/useNotificationTypePrefs.ts"),
      "utf8",
    );

    expect(source).not.toMatch(
      /import\s*\{[^}]*BUSINESS_NOTIFICATION_TEMPLATES[^}]*\}\s*from\s*["'][^"']*businessNotificationTemplates["']/s,
    );
    expect(source).toContain("businessNotificationDefaultOptIn(type, channel)");
  });

  test("the only push-off default remains teammate-joined", () => {
    const types = Object.keys(
      BUSINESS_NOTIFICATION_TEMPLATES,
    ) as BusinessNotificationType[];
    expect(
      types.filter(
        (type) => !businessNotificationDefaultOptIn(type, "push"),
      ),
    ).toEqual(["business.team_member_joined"]);
  });
});
