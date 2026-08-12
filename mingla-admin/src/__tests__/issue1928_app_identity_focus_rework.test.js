import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { acceptRequest, shouldRestoreCompletionFocus } from "../lib/adAppReadiness.js";
const here=path.dirname(fileURLToPath(import.meta.url));const panel=fs.readFileSync(path.resolve(here,"../components/app-readiness/AppDownloadReadinessPanel.jsx"),"utf8");

test("#1928 exact target and monotonic request guard reject switched aborted superseded and late responses",()=>{
  const base={selectedKey:"business:android",capturedKey:"business:android",currentRequestId:7,capturedRequestId:7,mounted:true,aborted:false};assert.equal(acceptRequest(base),true);
  for(const mutation of [{selectedKey:"business:ios"},{capturedKey:"explorer:android"},{currentRequestId:8},{mounted:false},{aborted:true}])assert.equal(acceptRequest({...base,...mutation}),false);
});

test("#1928 completion focus returns only to useful control for matching selected request",()=>{
  const base={pending:{targetKey:"business:android",requestId:7},selectedKey:"business:android",currentRequestId:7,phase:"idle",online:true,buttonDisabled:false};assert.equal(shouldRestoreCompletionFocus(base),true);assert.equal(shouldRestoreCompletionFocus({...base,phase:"error"}),true);
  for(const mutation of [{pending:null},{selectedKey:"explorer:android"},{currentRequestId:8},{phase:"checking"},{online:false},{buttonDisabled:true}])assert.equal(shouldRestoreCompletionFocus({...base,...mutation}),false);
});

test("#1928 completion token remains one-shot post-render with accessible states",()=>{
  const effect=panel.indexOf("const pending=completionFocus.current");const handler=panel.indexOf("const runCheck=async");assert.ok(effect>0&&effect<handler);assert.match(panel,/completionFocus\.current=null/);assert.match(panel,/if\(restore\)action\.focus\(\)/);assert.doesNotMatch(panel.slice(handler),/requestAnimationFrame\(\(\)=>actionRef\.current\?\.focus/);
  for(const contract of [/aria-live="polite"/,/aria-busy=/,/role="alert"/,/targetKey\(appKey,os\)/])assert.match(panel,contract);
});
