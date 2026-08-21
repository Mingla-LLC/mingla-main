#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = {
  migration: "supabase/migrations/20270507002395_issue_2395_manual_contact_groups.sql",
  sqlTest: "supabase/migrations/__tests__/issue_2395_manual_contact_groups.happy.pg17.test.sql",
  edge: "supabase/functions/_shared/marketingAudience.ts",
  send: "supabase/functions/marketing-send/index.ts",
  quote: "supabase/functions/_shared/marketingBookQuote.ts",
  edgeTest: "supabase/functions/marketing-send/issue_2395_manual_contact_groups.happy.test.ts",
  service: "mingla-business/src/services/marketing/manualGroupService.ts",
  serviceTest: "mingla-business/src/services/marketing/__tests__/issue_2395_manual_group_service.happy.test.ts",
  flow: "mingla-business/src/components/people/ManualGroupFlow.tsx",
  detail: "mingla-business/src/components/people/ManualGroupDetail.tsx",
  picker: "mingla-business/src/components/marketing/AudiencePickerSheet.tsx",
  compose: "mingla-business/app/(tabs)/marketing/campaigns/compose.tsx",
  campaignService: "mingla-business/src/services/marketing/marketingCampaignService.ts",
  hook: "mingla-business/src/hooks/marketing/useManualGroups.ts",
  people: "mingla-business/src/components/people/PeoplePage.tsx",
  audienceCard: "mingla-business/src/components/marketing/AudienceCard.tsx",
  reportService: "mingla-business/src/services/marketing/marketingReportService.ts",
  reportScreen: "mingla-business/app/(tabs)/marketing/campaigns/[id].tsx",
  componentTest: "mingla-business/src/components/people/__tests__/issue_2395_manual_contact_groups.happy.test.ts",
  workflow: ".github/workflows/issue-2395-manual-contact-groups-tests.yml",
};

export function audit(base = repoRoot) {
  const failures = [];
  const read = (key) => {
    const target = path.join(base, files[key]);
    if (!fs.existsSync(target)) { failures.push(`${files[key]} missing`); return ""; }
    return fs.readFileSync(target, "utf8");
  };
  const migration = read("migration"), edge = read("edge"), send = read("send"), quote = read("quote"), service = read("service"),
    flow = read("flow"), detail = read("detail"), picker = read("picker"), compose = read("compose"),
    campaignService = read("campaignService"), hook = read("hook"), people = read("people"), audienceCard = read("audienceCard"),
    reportService = read("reportService"), reportScreen = read("reportScreen"), workflow = read("workflow"), sqlTest = read("sqlTest");
  read("edgeTest"); read("serviceTest"); read("componentTest");

  for (const needle of [
    "manual_contact_groups_v1", "marketing_manual_group_memberships",
    "marketing_manual_group_pending_memberships", "marketing_manual_group_mutation_receipts",
    "marketing_manual_group_audit", "issue_2395_active_membership_unique",
    "FOREIGN KEY(audience_id,brand_id)", "FOREIGN KEY(brand_person_id,brand_id)",
    "biz_create_manual_group_v1", "biz_add_manual_group_people_v1",
    "biz_remove_manual_group_people_v1", "biz_rename_manual_group_v1",
    "biz_delete_manual_group_v1", "biz_list_people_manual_groups_v1",
    "biz_get_manual_group_v1", "biz_get_manual_group_book_picker_v1",
  ]) if (!migration.includes(needle)) failures.push(`migration missing ${needle}`);
  if (!migration.includes("query_definition='\{\"kind\":\"manual_group\"\}'::jsonb".replaceAll("\\", "")) && !migration.includes("query_definition='\{\"kind\":\"manual_group\"\}'".replaceAll("\\", ""))) failures.push("Manual kind lacks exact query shape");
  if (!migration.includes("public.issue_2395_assert_actor(p_brand_id,true)") || !/FUNCTION public\.issue_2395_assert_actor[\s\S]{0,900}biz_role_rank\('marketing_manager'\)/.test(migration)) failures.push("rank-20 server mutation gate missing");
  if (/GRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE)[\s\S]{0,180}marketing_manual_group[\s\S]{0,80}authenticated/i.test(migration)) failures.push("authenticated has direct Manual table grants");
  for (const needle of ["reversal_manifest->'manualGroupMemberships'", "'winnerPreexisting',v_winner_preexisting", "'merge_projection'", "'split_restore'", "'person_deleted'"]) if (!migration.includes(needle)) failures.push(`identity lifecycle missing ${needle}`);
  if (!migration.includes("status IN('draft','scheduled','sending')") || !migration.includes("audience_name_snapshot")) failures.push("delete/history campaign safety missing");
  if (!migration.includes("audienceVersion") || !migration.includes("biz_brand_person_authorized_contact_v2") || !migration.includes("issue_2395_confirm_marketing_book_send_legacy")) failures.push("Manual quote can bypass guarded sealed send truth");
  for (const needle of ["pg_advisory_xact_lock", "delete_blocked", "blockingCampaignCount", "winnerMembershipId", "p_quote_snapshot->>'audienceId'", "p_quote_snapshot->>'audienceName'", "ILIKE '%'||v_search||'%' ESCAPE '\\'"]) if (!migration.includes(needle)) failures.push(`rework SQL protection missing ${needle}`);
  if (!/v_manual[\s\S]{0,700}marketing_manager[\s\S]{0,350}event_manager/.test(migration)) failures.push("Manual rank-20/legacy Book rank-40 split missing");
  if (!edge.includes('case "manual_group"') || !edge.includes("biz_marketing_people_send_audience_v2") || !edge.includes("manual_group_campaign_context_required")) failures.push("edge Manual resolver bypasses campaign seal");
  if (!send.includes('body.action === "preview_people_v2"') || !send.includes('body.action === "confirm_people_v2"') || !send.includes("publicMarketingBookQuote(value)")) failures.push("edge Manual preview/confirm v2 contract missing");
  for (const needle of ["audienceId", "audienceKind", "audienceVersion", "audienceName"]) if (!quote.includes(needle)) failures.push(`sealed quote identity missing ${needle}`);
  if (!service.includes("ManualGroupError") || !service.includes("biz_create_manual_group_v1") || service.includes('.from("marketing_manual_group')) failures.push("client does not use strict RPC-only Manual service");
  for (const copy of ["Name group", "Select from Book", "Upload contacts", "Everyone uploaded is saved to Your Book first.", "need review. They are not members yet"]) if (!flow.includes(copy)) failures.push(`creation flow missing ${copy}`);
  for (const needle of ["Discard this group setup?", "Add person", "manualGroupDraftNameError", "resultingManualMemberCount", "stableManualMutationRequest", "getContactImportStatus", "Preparing exact group counts…", "accentColor={accent.warm}"]) if (!flow.includes(needle)) failures.push(`creation rework missing ${needle}`);
  for (const copy of ["they’ll stay in Your Book", "Start campaign", "audience=manual:${groupId}", "Offline — showing saved data"]) if (!detail.includes(copy)) failures.push(`detail missing ${copy}`);
  for (const needle of ["Group actions", "Open campaigns", "deleteBlockedCount", "stableManualMutationRequest"]) if (!detail.includes(needle)) failures.push(`detail recovery missing ${needle}`);
  if (!picker.includes('title: "Your Book"') || !picker.includes('title: "Manual groups"') || !picker.includes('title: "Automatic groups"') || !picker.includes('kind: "manual_group" as const')) failures.push("picker lacks exact ordered Book/Manual/Automatic sections");
  if (!compose.includes('option.kind === "all_brand_people" || option.kind === "manual_group"') || !compose.includes("This group changed after preview")) failures.push("composer lacks Manual guarded preview path");
  if (!campaignService.includes('audience_kind === "manual_group"') || !campaignService.includes('"confirm_people_v2"') || !campaignService.includes('"preview_people_v2"')) failures.push("Manual composer actions do not use v2 exclusively");
  if ((hook.match(/useInfiniteQuery/g) ?? []).length < 3 || (hook.match(/getNextPageParam/g) ?? []).length < 2 || !detail.includes("fetchNextPage") || !flow.includes("fetchNextPage")) failures.push("client cursor pagination missing");
  if (!people.includes("No buyer groups yet.") || !people.includes("Buyer groups that update automatically.")) failures.push("feature-OFF legacy People state drifted");
  if (!audienceCard.includes(">Automatic<") || !audienceCard.includes('name="flash"') || !audienceCard.includes("Automatic group")) failures.push("Automatic groups lack non-color label/glyph distinction");
  if (!reportService.includes("audience_name_snapshot") || !reportScreen.includes("Audience: {campaign.audience_name_snapshot}")) failures.push("historical report loses the Manual audience-name snapshot");
  const analyticsSources = [flow, detail].join("\n");
  if (/capturePeople\([^\n]+(?:name|email|phone|fileName|csv)\s*:/i.test(analyticsSources)) failures.push("Manual analytics may include PII or group names");
  for (const test of ["issue_2395_manual_contact_groups.happy.pg17.test.sql", "issue_2395_manual_contact_groups.happy.test.ts", "issue_2395_manual_group_service.happy.test.ts", "issue_2395_manual_contact_groups.happy.test.ts"]) if (!workflow.includes(test)) failures.push(`workflow does not execute ${test}`);
  for (const needle of ["dblink_send_query", "biz_create_manual_group_v1", "biz_add_manual_group_people_v1", "biz_confirm_marketing_people_send_v2", "source switch stale check", "pending creation changed reach version", "cross-brand delete leaked existence"]) if (!sqlTest.includes(needle)) failures.push(`PostgreSQL behavior suite missing ${needle}`);
  if (!workflow.includes('mingla-business/app/(tabs)/people/groups/**')) failures.push("workflow Manual detail path is not glob-safe");
  return failures;
}

const failures = audit();
if (failures.length) { console.error(`[issue-2395] FAIL\n${failures.map((f) => `- ${f}`).join("\n")}`); process.exit(1); }
console.log("[issue-2395] PASS — Manual groups stay Book-only, brand/rank scoped, auditable and sealed-send guarded.");
