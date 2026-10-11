/**
 * #3682 Wave 2.7 — blast monthly caps + week warning wiring.
 */
import { assert } from "https://deno.land/std@0.224.0/assert/mod.ts";

Deno.test("#3682 Wave 2.7 happy: migration pins usage + assert + confirm gates", async () => {
  const migration = await Deno.readTextFile(
    new URL(
      "../../../migrations/20270809003682_issue_3682_blast_caps_and_week_warning.sql",
      import.meta.url,
    ),
  );
  assert(migration.includes("biz_brand_blast_usage_v1"));
  assert(migration.includes("biz_assert_brand_blast_allowance_v1"));
  assert(migration.includes("book_blast_monthly_cap_exceeded"));
  assert(migration.includes("pg_advisory_xact_lock"));
  assert(migration.includes("blast_cap:"));
  assert(migration.includes("smsCap"));
  assert(migration.includes("emailCap"));
  assert(migration.includes("blastsThisWeek"));
  assert(migration.includes("weekWarningAt"));
  assert(migration.includes("issue_2395_confirm_marketing_book_send_legacy"));
  assert(migration.includes("biz_confirm_marketing_circle_send_v1"));
  assert(migration.includes("biz_assert_brand_blast_allowance_v1("));
  assert(
    !/GRANT EXECUTE ON FUNCTION public\.biz_brand_blast_usage_v1\(uuid, uuid\) TO authenticated/
      .test(migration),
  );
});

Deno.test("#3682 Wave 2.7 happy: marketing-send surfaces allowance + cap error", async () => {
  const send = await Deno.readTextFile(
    new URL("../../marketing-send/index.ts", import.meta.url),
  );
  assert(send.includes("biz_brand_blast_usage_v1"));
  assert(send.includes("attachBookAllowance"));
  assert(send.includes("allowance"));
  assert(send.includes("BOOK_BLAST_MONTHLY_CAP_EXCEEDED"));
  assert(send.includes("book_blast_monthly_cap_exceeded"));
  assert(send.includes("BOOK_BLAST_COST_UNAVAILABLE"));
});

Deno.test("#3682 Wave 2.7 happy: Host review sheet + compose wire warning + allowance", async () => {
  const sheet = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/components/marketing/ComposerReviewSheet.tsx",
      import.meta.url,
    ),
  );
  assert(sheet.includes("weekBlastWarning"));
  assert(sheet.includes("allowanceLabel"));
  assert(sheet.includes("Send anyway"));
  assert(sheet.includes("Not now"));
  assert(sheet.includes("composer-review-week-warning"));

  const compose = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/app/(tabs)/marketing/campaigns/compose.tsx",
      import.meta.url,
    ),
  );
  assert(compose.includes("bookAllowanceLabel"));
  assert(compose.includes("bookWeekBlastWarning"));
  assert(compose.includes("MONTHLY_CAP"));

  const preview = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/hooks/marketing/useBookBlastPreview.ts",
      import.meta.url,
    ),
  );
  assert(preview.includes("smsRemaining"));
  assert(preview.includes("emailRemaining"));

  const types = await Deno.readTextFile(
    new URL(
      "../../../../mingla-business/src/types/marketing.ts",
      import.meta.url,
    ),
  );
  assert(types.includes("MarketingBookAllowance"));
  assert(types.includes("allowance?"));
});

Deno.test("#3682 Wave 2.7 happy: Explorer Manage restores Push channel toggle", async () => {
  const manage = await Deno.readTextFile(
    new URL(
      "../../../../app-mobile/src/components/profile/BrandsYouFollowManageSheet.tsx",
      import.meta.url,
    ),
  );
  assert(manage.includes('["push", "Push", "notifications-outline"]'));
  assert(manage.includes("push, email and text"));

  const section = await Deno.readTextFile(
    new URL(
      "../../../../app-mobile/src/components/profile/BrandsYouFollowSection.tsx",
      import.meta.url,
    ),
  );
  assert(section.includes("Push, email and text") || section.includes("push"));
});
