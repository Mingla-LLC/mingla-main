#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const files = {
  route: "mingla-business/app/(tabs)/marketing/people/index.tsx",
  legacy: "mingla-business/app/(tabs)/marketing/audiences/index.tsx",
  page: "mingla-business/src/components/people/PeoplePage.tsx",
  detail: "mingla-business/src/components/people/PersonDetailView.tsx",
  service: "mingla-business/src/services/peopleService.ts",
  importRoute: "mingla-business/app/(tabs)/people/import.tsx",
  importHook: "mingla-business/src/hooks/useContactImport.ts",
  analytics: "mingla-business/src/features/people/peopleAnalytics.ts",
  marketingKeys: "mingla-business/src/hooks/marketing/marketingKeys.ts",
  flagHook: "mingla-business/src/hooks/useFeatureFlag.ts",
  migration: "supabase/migrations/20270329001774_issue_1774_people_page.sql",
  digestFix: "supabase/migrations/20270330001774_issue_1774_qualify_people_digest.sql",
  marketingAudit: "scripts/audit/marketing-grade-a-contract.mjs",
};

export function audit(base) {
  const failures = [];
  const read = (key) => {
    const target = path.join(base, files[key]);
    if (!fs.existsSync(target)) { failures.push(`${files[key]} is missing`); return ""; }
    return fs.readFileSync(target, "utf8");
  };
  const route=read("route"),legacy=read("legacy"),page=read("page"),detail=read("detail"),service=read("service"),importRoute=read("importRoute"),importHook=read("importHook"),analytics=read("analytics"),marketingKeys=read("marketingKeys"),flagHook=read("flagHook"),migration=read("migration"),digestFix=read("digestFix"),marketingAudit=read("marketingAudit");
  if (!route.includes("<PeoplePage")) failures.push("canonical People route does not mount PeoplePage");
  if (!legacy.includes('<Redirect href="/(tabs)/marketing/people"') || /AudienceListScreen|useAudienceList/.test(legacy)) failures.push("legacy Audiences route is not a renderless People redirect");
  if (/\.from\s*\(/.test([page,detail,service].join("\n"))) failures.push("People book/detail bypasses the RPC service boundary");
  for (const rpc of ["biz_get_brand_people_book","biz_get_brand_person","biz_add_brand_person"]) if (!service.includes(`rpc(\"${rpc}\"`)) failures.push(`service is missing ${rpc}`);
  if (/People you can reach|Reach unavailable|Followers|Extended circle|Export unavailable|Book export is coming soon/.test(page) || /followersCount|extendedCircleCount|estimatedReach/.test(page)) failures.push("future reach/export dependency is rendered or fabricated");
  if (!page.includes('useFeatureFlag("contact_import_v1")') || !/!flag\.isPending\s*&&\s*!flag\.isFetching\s*&&\s*!flag\.isError\s*&&\s*flag\.data\s*===\s*true/.test(page)) failures.push("contact import is not fail-closed on the canonical flag");
  if (/contact_import_v1|getFeatureFlag|feature_flags/.test([service,detail,importRoute,importHook,marketingKeys].join("\n"))) failures.push("People created a duplicate contact-import rollout authority");
  if (!flagHook.includes("featureFlagKeys.detail(flagKey)") || !flagHook.includes("isAuthReady && user !== null")) failures.push("canonical feature-flag query authority was weakened");
  if (/posthog|PostHog/.test(page)) failures.push("PostHog is being used as People availability authority");
  if (!importRoute.includes('returnTo === "marketingPeople"') || !importRoute.includes('router.replace("/(tabs)/marketing/people"') || !importRoute.includes('"beforeRemove"')) failures.push("import does not bind brand/return intent and replace every exit");
  if (!importHook.includes("marketingKeys.people.all(v.brandId)")) failures.push("successful import does not invalidate the People book");
  // [TEST-MOD-APPROVED #1772] Match declared property keys exactly. Safe enum
  // values (`channel: "email" | "phone"`) and bucket names are not PII fields.
  const analyticsSchema = analytics.match(
    /export interface PeopleEventProperties\s*\{([\s\S]*?)\}/,
  )?.[1] ?? "";
  const analyticsKeys = new Set(
    [...analyticsSchema.matchAll(/(?:^|;)\s*([A-Za-z][A-Za-z0-9]*)\??\s*:/g)]
      .map((match) => match[1]),
  );
  const forbiddenAnalyticsKeys = [
    "email", "phone", "displayName", "personId", "brandId", "contactValue",
  ];
  if (forbiddenAnalyticsKeys.some((key) => analyticsKeys.has(key))) failures.push("People analytics schema contains identity/contact properties");
  const authNeedles=["biz_brand_effective_rank(p_brand_id,v_uid)","biz_role_rank('marketing_manager')"];
  for (const needle of authNeedles) if (!migration.includes(needle)) failures.push(`migration authorization is missing ${needle}`);
  if (!migration.includes("brand_person_manual_add_requests") || !migration.includes("pg_advisory_xact_lock") || !migration.includes("people_idempotency_conflict")) failures.push("manual add lacks durable idempotency authority");
  const digestFunction=digestFix.split("REVOKE ALL ON FUNCTION")[0];
  if (!/v_hash\s*:=\s*encode\s*\(\s*extensions\.digest\s*\(/.test(digestFunction) || /v_hash\s*:=\s*encode\s*\(\s*digest\s*\(/.test(digestFunction)) failures.push("manual add digest is not extension-qualified in the forward correction");
  if (!marketingAudit.includes('label: "legacy-audiences-redirect"') || !marketingAudit.includes('label: "people"') || !marketingAudit.includes('book.kind==="offlineEmpty"')) failures.push("marketing Grade A audit does not split the legacy redirect from truthful People ownership");
  return failures;
}

function selfTest() {
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),"issue-1774-gate-"));
  try {
    for (const relative of Object.values(files)) { const target=path.join(tmp,relative); fs.mkdirSync(path.dirname(target),{recursive:true}); fs.copyFileSync(path.join(root,relative),target); }
    if (audit(tmp).length) throw new Error(`clean fixture failed: ${audit(tmp).join("; ")}`);
    const legacy=path.join(tmp,files.legacy); fs.writeFileSync(legacy,"export default function Audiences(){ return null }\n");
    if (!audit(tmp).some((x)=>x.includes("renderless People redirect"))) throw new Error("true mutation: deleting the redirect was not detected");
    fs.copyFileSync(path.join(root,files.legacy),legacy);
    const page=path.join(tmp,files.page); fs.appendFileSync(page,"\nconst estimatedReach = 999;\n");
    if (!audit(tmp).some((x)=>x.includes("rendered or fabricated"))) throw new Error("true mutation: fabricated reach was not detected");
    fs.copyFileSync(path.join(root,files.page),page);
    fs.appendFileSync(page,'\nconst futurePlaceholder = "Extended circle";\n');
    if (!audit(tmp).some((x)=>x.includes("rendered or fabricated"))) throw new Error("true mutation: restored future dependency UI was not detected");
    fs.copyFileSync(path.join(root,files.page),page);
    for (const needle of ["!flag.isPending","!flag.isFetching","!flag.isError","flag.data===true","useFeatureFlag(\"contact_import_v1\")"]) {
      const clean=fs.readFileSync(page,"utf8"),broken=clean.replace(needle,needle.includes("useFeatureFlag")?'useFeatureFlag("other_flag")':"true");
      fs.writeFileSync(page,broken);
      if (!audit(tmp).some((x)=>x.includes("fail-closed on the canonical flag"))) throw new Error(`true mutation: ${needle} removal was not detected`);
      fs.writeFileSync(page,clean);
    }
    const keys=path.join(tmp,files.marketingKeys); fs.appendFileSync(keys,"\nconst contact_import_v1 = true;\n");
    if (!audit(tmp).some((x)=>x.includes("duplicate contact-import rollout authority"))) throw new Error("true mutation: duplicate flag authority was not detected");
    fs.copyFileSync(path.join(root,files.marketingKeys),keys);
    const digestFix=path.join(tmp,files.digestFix),cleanDigest=fs.readFileSync(digestFix,"utf8"); fs.writeFileSync(digestFix,cleanDigest.replace("v_hash := encode(extensions.digest(","v_hash := encode(digest("));
    if (!audit(tmp).some((x)=>x.includes("digest is not extension-qualified"))) throw new Error("true mutation: unqualified People digest was not detected");
    fs.writeFileSync(digestFix,cleanDigest);
    const marketingAudit=path.join(tmp,files.marketingAudit),cleanAudit=fs.readFileSync(marketingAudit,"utf8"); fs.writeFileSync(marketingAudit,cleanAudit.replace('label: "people"','label: "retired-audiences"'));
    if (!audit(tmp).some((x)=>x.includes("does not split the legacy redirect"))) throw new Error("true mutation: stale Grade A ownership was not detected");
    fs.writeFileSync(marketingAudit,cleanAudit);
    const analytics=path.join(tmp,files.analytics),cleanAnalytics=fs.readFileSync(analytics,"utf8");
    fs.writeFileSync(analytics,cleanAnalytics.replace("platform?:string;","platform?:string;contactValue?:string;"));
    if (!audit(tmp).some((x)=>x.includes("identity/contact properties"))) throw new Error("true mutation: forbidden analytics property key was not detected");
    console.log("[issue-1774-people-page] self-test PASS");
  } finally { fs.rmSync(tmp,{recursive:true,force:true}); }
}

if (process.argv.includes("--self-test")) selfTest();
else {
  const failures=audit(root);
  if (failures.length) { for (const failure of failures) console.error(`[issue-1774-people-page] FAIL: ${failure}`); process.exit(1); }
  console.log("[issue-1774-people-page] PASS");
}
