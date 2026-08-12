import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { countsFor, demoteLatest, validateReadinessResponse } from "../lib/adAppReadiness.js";
import { response } from "./fixtures/issue1950Readiness.js";

const here=path.dirname(fileURLToPath(import.meta.url));const root=path.resolve(here,"../..");const read=(relative)=>fs.readFileSync(path.join(root,relative),"utf8");

test("#1928 consolidated authority accepts exact app OS and five-provider order only",()=>{
  assert.ok(validateReadinessResponse(response,"explorer","ios"));
  const wrong=structuredClone(response);wrong.targets[0].app_key="business";assert.equal(validateReadinessResponse(wrong,"explorer","ios"),null);
  const reordered=structuredClone(response);reordered.targets[0].latest.results.reverse();const accepted=validateReadinessResponse(reordered,"explorer","ios");assert.equal(countsFor(accepted.selected.latest).blocked,5);
  const missing=structuredClone(response);missing.targets[0].latest.results.pop();assert.equal(countsFor(validateReadinessResponse(missing,"explorer","ios").selected.latest).blocked,5);
});

test("#1928 consolidated authority keeps sibling identities isolated and nonready sets cannot become Ready",()=>{
  const mixed=structuredClone(response);mixed.targets[2].latest.results[0].verdict="action_required";mixed.targets[2].latest.results[0].owner_label="Engineering";mixed.targets[2].latest.results[0].action_code="review_mingla_configuration";
  const accepted=validateReadinessResponse(mixed,"business","ios");assert.equal(countsFor(accepted.selected.latest).ready,4);assert.equal(countsFor(accepted.selected.latest).action_required,1);assert.equal(countsFor(accepted.targets[0].latest).ready,5);
  const duplicate=structuredClone(response);duplicate.targets[2].latest.results[1]={...duplicate.targets[2].latest.results[0]};assert.equal(countsFor(validateReadinessResponse(duplicate,"business","ios").selected.latest).blocked,5);
});

test("#1928 server freshness and immediate recheck demotion never preserve green",()=>{
  const boundary=structuredClone(response);boundary.server_now=boundary.targets[0].latest.stale_at;const accepted=validateReadinessResponse(boundary,"explorer","ios");assert.equal(countsFor(accepted.selected.latest).stale,5);assert.equal(countsFor(demoteLatest(response.targets[0].latest)).stale,5);
});

test("#1928 consolidated IA removes competing card while preserving exact backend evidence",()=>{
  const page=read("src/pages/AdEnginePage.jsx"),panel=read("src/components/app-readiness/AppDownloadReadinessPanel.jsx"),service=read("src/services/adEngineService.js");
  assert.ok(page.indexOf("<AdConnectionsPanel />")<page.indexOf("<AppDownloadReadinessPanel />"));assert.ok(page.indexOf("<AppDownloadReadinessPanel />")<page.indexOf("Web traffic campaigns"));assert.doesNotMatch(page,/<AppIdentityReadinessPanel/);
  assert.match(panel,/targetKey\(appKey,os\)/);assert.match(panel,/controllers\.current\[outgoing\]\?\.abort\(\)/);assert.match(service,/admin-ad-app-readiness/);assert.match(service,/admin-ad-app-identity-preflight/);
  assert.doesNotMatch(panel,/localStorage|sessionStorage|indexedDB|Campaign ready|App install ready|Growth ready|Ready to launch/i);
});
