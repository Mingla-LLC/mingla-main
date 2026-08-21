#!/usr/bin/env node
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const sources = {
  auth: read("supabase/functions/_shared/agentToolAuthorization.ts"),
  tools: read("supabase/functions/_shared/agentTools.ts"),
  domain: read("supabase/functions/_shared/agentDomainTools.ts"),
  chat: read("supabase/functions/agent-chat/index.ts"),
  confirm: read("supabase/functions/agent-confirm-action/index.ts"),
  workflow: read(".github/workflows/issue-2019-ari-delegated-auth.yml"),
};

function check(s) {
  const failures = [];
  const declarationCount = (s.auth.match(/:\s*role\("/g) ?? []).length;
  // [TEST-MOD-APPROVED #2063] Three certified brand tools extend the current
  // #1973/#1985 authorization denominator without changing inherited roles.
  if (declarationCount !== 70) failures.push(`expected 70 declarations, got ${declarationCount}`);
  // [TEST-MOD-APPROVED #1973] [TEST-MOD-APPROVED #1974] experience lifecycle
  // and ticket-pricing tools are additive delegated declarations.
  if (declarationCount !== 68) failures.push(`expected 68 declarations, got ${declarationCount}`);
  // [TEST-MOD-APPROVED #1971] five trip graph/read tools bring the registry to 72.
  if (declarationCount !== 72) failures.push(`expected 72 declarations, got ${declarationCount}`);
  for (const needle of ["biz_brand_effective_rank_for_caller", 'rpc("biz_role_rank"', "secureAgentTools(", "await authorizeAgentTool"]) {
    if (!Object.values(s).some((value) => value.includes(needle))) failures.push(`missing ${needle}`);
  }
  const proposal = s.chat.indexOf("await authorizeAgentTool(tool, gemini.toolCall.args");
  const pending = s.chat.indexOf('.from("agent_pending_actions")', proposal);
  if (proposal < 0 || pending < proposal) failures.push("proposal authorization ordering broken");
  const finalArgs = s.confirm.indexOf("const finalArgs");
  const finalAuth = s.confirm.indexOf("await authorizeAgentTool(tool, finalArgs");
  const executing = s.confirm.indexOf('status: "executing"', finalAuth);
  if (!(finalArgs >= 0 && finalAuth > finalArgs && executing > finalAuth)) failures.push("confirmation ordering broken");
  const protectedSource = [s.auth, s.tools, s.domain].join("\n");
  for (const forbidden of ["assertBrandOwned", "assertEventOwned", 'rpc("biz_brand_effective_rank"', "service_role"]) {
    if (protectedSource.includes(forbidden)) failures.push(`forbidden authorization seam: ${forbidden}`);
  }
  if (!s.workflow.includes("issue_2019_agent_authorization.tester-adversarial.test.ts")) failures.push("tester suite not wired");
  return failures;
}

if (process.argv.includes("--self-test")) {
  const mutations = [
    { ...sources, auth: sources.auth.replaceAll("biz_brand_effective_rank_for_caller", "removed_rank_rpc") },
    { ...sources, chat: sources.chat.replace("await authorizeAgentTool(tool, gemini.toolCall.args", "await removed(tool, gemini.toolCall.args") },
    { ...sources, confirm: sources.confirm.replace('status: "executing"', 'status: "removed"') },
    { ...sources, auth: sources.auth.replace(/:\s*role\("/, ": removed(") },
  ];
  if (mutations.some((mutation) => check(mutation).length === 0)) {
    console.error("issue-2019 self-test FAIL: a material revert escaped");
    process.exit(1);
  }
  console.log("issue-2019 self-test PASS");
  process.exit(0);
}

const failures = check(sources);
if (failures.length) {
  console.error("issue-2019 FAIL:\n" + failures.map((item) => `  - ${item}`).join("\n"));
  process.exit(1);
}
console.log("issue-2019 PASS");
