import test from "node:test";import assert from "node:assert/strict";import fs from "node:fs";
const source=fs.readFileSync(new URL("../ToolLeadsPage.jsx",import.meta.url),"utf8");
const competitorOps=source.slice(source.indexOf("function CompetitorOpsPanel"));
test("Competitor Ops is a bounded tab with capability generations",()=>{for(const value of ["Competitor Ops","TikTok is link only and cannot be enabled here.","Generation {cap.generation}","Pause checking","Resume checking"])assert.ok(source.includes(value));});
test("Competitor Ops exposes safe fields and bounded retry only",()=>{for(const value of ["Watch ID","Brand ID","Budget reserved / actual","Safe reason","Retry once","admin_retry_count < 1"])assert.ok(competitorOps.includes(value));for(const forbidden of ["row.normalized_url","row.caption","row.email","row.ip_hash","row.provider_object_id"])assert.ok(!competitorOps.includes(forbidden));});
