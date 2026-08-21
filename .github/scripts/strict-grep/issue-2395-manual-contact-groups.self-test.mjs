#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { audit } from "./issue-2395-manual-contact-groups.mjs";

if (!process.argv.includes("--self-test")) {
  console.error("usage: issue-2395-manual-contact-groups.self-test.mjs --self-test");
  process.exit(2);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const tracked = [
  "supabase/migrations/20270507002395_issue_2395_manual_contact_groups.sql",
  "supabase/migrations/__tests__/issue_2395_manual_contact_groups.happy.pg17.test.sql",
  "supabase/functions/_shared/marketingAudience.ts",
  "supabase/functions/_shared/marketingBookQuote.ts",
  "supabase/functions/marketing-send/index.ts",
  "supabase/functions/marketing-send/issue_2395_manual_contact_groups.happy.test.ts",
  "mingla-business/src/services/marketing/manualGroupService.ts",
  "mingla-business/src/services/marketing/marketingCampaignService.ts",
  "mingla-business/src/hooks/marketing/useManualGroups.ts",
  "mingla-business/src/services/marketing/__tests__/issue_2395_manual_group_service.happy.test.ts",
  "mingla-business/src/components/people/ManualGroupFlow.tsx",
  "mingla-business/src/components/people/ManualGroupDetail.tsx",
  "mingla-business/src/components/people/PeoplePage.tsx",
  "mingla-business/src/components/marketing/AudienceCard.tsx",
  "mingla-business/src/components/marketing/AudiencePickerSheet.tsx",
  "mingla-business/app/(tabs)/marketing/campaigns/compose.tsx",
  "mingla-business/src/services/marketing/marketingReportService.ts",
  "mingla-business/app/(tabs)/marketing/campaigns/[id].tsx",
  "mingla-business/src/components/people/__tests__/issue_2395_manual_contact_groups.happy.test.ts",
  ".github/workflows/issue-2395-manual-contact-groups-tests.yml",
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "issue-2395-self-test-"));
try {
  for (const rel of tracked) { const dest = path.join(tmp, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(root, rel), dest); }
  const clean = audit(tmp); if (clean.length) throw new Error(`clean fixture failed: ${clean.join("; ")}`);
  const mutations = [
    ["supabase/migrations/20270507002395_issue_2395_manual_contact_groups.sql", "biz_role_rank('marketing_manager')", "biz_role_rank('scanner')", "rank-20"],
    ["supabase/migrations/20270507002395_issue_2395_manual_contact_groups.sql", "reversal_manifest->'manualGroupMemberships'", "reversal_manifest->'lostMembershipManifest'", "merge provenance"],
    ["supabase/functions/_shared/marketingAudience.ts", "biz_marketing_people_send_audience_v2", "unsafe_live_group_people", "campaign seal"],
    ["supabase/functions/marketing-send/index.ts", "publicMarketingBookQuote(value)", "value", "public quote boundary"],
    ["mingla-business/src/components/people/ManualGroupFlow.tsx", "Everyone uploaded is saved to Your Book first.", "Upload directly to this group.", "Book-first copy"],
    ["mingla-business/app/(tabs)/marketing/campaigns/compose.tsx", "This group changed after preview", "Continue with old preview", "stale preview"],
    ["supabase/migrations/20270507002395_issue_2395_manual_contact_groups.sql", "pg_advisory_xact_lock", "pg_advisory_xact_unlock", "concurrent receipt"],
    ["mingla-business/src/hooks/marketing/useManualGroups.ts", "useInfiniteQuery", "useQuery", "client pagination"],
    ["mingla-business/src/components/marketing/AudiencePickerSheet.tsx", 'title: "Manual groups"', 'title: "Segments"', "picker sections"],
  ];
  for (const [rel, needle, replacement, label] of mutations) {
    const target = path.join(tmp, rel), original = fs.readFileSync(target, "utf8");
    if (!original.includes(needle)) throw new Error(`fixture needle missing: ${label}`);
    fs.writeFileSync(target, original.replace(needle, replacement));
    const failures = audit(tmp); if (failures.length === 0) throw new Error(`negative control stayed green: ${label}`);
    fs.writeFileSync(target, original);
  }
  console.log("[issue-2395 self-test] PASS — nine true-deletion-equivalent negative controls fail and restore cleanly.");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
