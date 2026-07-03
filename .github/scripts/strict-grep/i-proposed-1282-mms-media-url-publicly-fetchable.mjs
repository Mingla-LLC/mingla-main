#!/usr/bin/env node
/**
 * ORCH-1282 — I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE (DRAFT until CLOSE).
 *
 * Rule: any `media_urls` entry on an SMS payload MUST be a verified PUBLIC URL
 * on the `brand_covers` bucket — obtained via getPublicUrl and proven reachable
 * via verifyBrandCoverPublicUrl BEFORE it is written into the payload. No local
 * file:// / blob uri ever reaches the payload.
 *
 *   (1) marketingMmsImageService.ts: uploads under the `marketing-mms/` prefix,
 *       caps at 5 MB, excludes webp, calls getPublicUrl THEN
 *       verifyBrandCoverPublicUrl, and returns the verified public URL.
 *   (2) compose.tsx: sets media_urls from the uploaded (verified) URL, the
 *       payload uses mmsMediaUrls, and the LOCAL preview uri (mmsLocalUri) is
 *       NEVER written into media_urls.
 *
 * Mirrors the modular self-testing gate pattern.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE = "mingla-business/src/services/marketingMmsImageService.ts";
const COMPOSE = "mingla-business/app/(tabs)/marketing/campaigns/compose.tsx";

const stripLineComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const evaluateService = (rawCode) => {
  const code = stripLineComments(rawCode);
  const failures = [];
  if (!/marketing-mms\//.test(code)) {
    failures.push(`${SERVICE}: must upload under the \`marketing-mms/\` key prefix. I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
  }
  if (!/getPublicUrl\s*\(/.test(code)) {
    failures.push(`${SERVICE}: must derive the URL via getPublicUrl(). I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
  }
  const verifyIdx = code.search(/verifyBrandCoverPublicUrl\s*\(/);
  const returnIdx = code.search(/return\s+data\.publicUrl/);
  if (verifyIdx === -1) {
    failures.push(`${SERVICE}: must verify reachability via verifyBrandCoverPublicUrl(). I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
  }
  if (returnIdx === -1) {
    failures.push(`${SERVICE}: must return the verified data.publicUrl. I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
  }
  if (verifyIdx !== -1 && returnIdx !== -1 && verifyIdx > returnIdx) {
    failures.push(`${SERVICE}: verifyBrandCoverPublicUrl() must run BEFORE returning the URL. I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
  }
  if (!/5\s*\*\s*1024\s*\*\s*1024/.test(code)) {
    failures.push(`${SERVICE}: MMS must cap at 5 MB (5 * 1024 * 1024). I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
  }
  if (/["']image\/webp["']/.test(code)) {
    failures.push(`${SERVICE}: webp is not an MMS-safe type — must be excluded. I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
  }
  return failures;
};

const evaluateCompose = (rawCode) => {
  const code = stripLineComments(rawCode);
  const failures = [];
  if (!/setMmsMediaUrls\(\[\s*url\s*\]\)/.test(code)) {
    failures.push(`${COMPOSE}: media_urls must be set from the uploaded (verified) URL — setMmsMediaUrls([url]). I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
  }
  if (!/media_urls:\s*mmsMediaUrls/.test(code)) {
    failures.push(`${COMPOSE}: the payload must carry media_urls: mmsMediaUrls (the verified array). I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
  }
  // The local preview uri must NEVER be written into the payload.
  if (/media_urls:\s*\[?\s*mmsLocalUri/.test(code)) {
    failures.push(`${COMPOSE}: mmsLocalUri (a local file:// / blob uri) must NEVER reach media_urls. I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
  }
  return failures;
};

const SELF_TEST = process.argv.includes("--self-test");
if (SELF_TEST) {
  const SVC_GOOD = `
    const MMS_MAX_BYTES = 5 * 1024 * 1024;
    const storagePath = \`\${brandId}/marketing-mms/\${token}.\${ext}\`;
    const { data } = supabase.storage.from(B).getPublicUrl(storagePath);
    await verifyBrandCoverPublicUrl(data.publicUrl);
    return data.publicUrl;
  `;
  // BAD_A: verify removed.
  const SVC_BAD_A = `
    const MMS_MAX_BYTES = 5 * 1024 * 1024;
    const storagePath = \`\${brandId}/marketing-mms/\${token}.\${ext}\`;
    const { data } = supabase.storage.from(B).getPublicUrl(storagePath);
    return data.publicUrl;
  `;
  // BAD_B: returns before verifying.
  const SVC_BAD_B = `
    const MMS_MAX_BYTES = 5 * 1024 * 1024;
    const storagePath = \`\${brandId}/marketing-mms/\${token}.\${ext}\`;
    const { data } = supabase.storage.from(B).getPublicUrl(storagePath);
    return data.publicUrl;
    await verifyBrandCoverPublicUrl(data.publicUrl);
  `;
  const CMP_GOOD = `
    const url = await uploadMarketingMmsImage(brandId, input);
    setMmsMediaUrls([url]);
    return { kind: "sms", body: smsBody, ...(mmsMediaUrls.length > 0 ? { media_urls: mmsMediaUrls } : {}) };
  `;
  // BAD_C: local uri leaks into the payload.
  const CMP_BAD_C = `
    setMmsMediaUrls([url]);
    return { kind: "sms", body: smsBody, media_urls: [mmsLocalUri] };
  `;
  const sg = evaluateService(SVC_GOOD), sa = evaluateService(SVC_BAD_A), sb = evaluateService(SVC_BAD_B);
  const cg = evaluateCompose(CMP_GOOD), cc = evaluateCompose(CMP_BAD_C);
  const ok = sg.length === 0 && sa.length >= 1 && sb.length >= 1 && cg.length === 0 && cc.length >= 1;
  if (!ok) {
    console.error("ORCH-1282 media-url-fetchable SELF-TEST failed:", { sg, sa, sb, cg, cc });
    process.exit(1);
  }
  console.log("ORCH-1282 media-url-fetchable gate self-test passed.");
  process.exit(0);
}

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();
const failures = [];
const svcAbs = join(root, SERVICE);
const cmpAbs = join(root, COMPOSE);
if (!existsSync(svcAbs)) failures.push(`${SERVICE}: not found.`);
else failures.push(...evaluateService(readFileSync(svcAbs, "utf8")));
if (!existsSync(cmpAbs)) failures.push(`${COMPOSE}: not found.`);
else failures.push(...evaluateCompose(readFileSync(cmpAbs, "utf8")));

if (failures.length > 0) {
  console.error("ORCH-1282 media-url-fetchable gate FAILED:");
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log("ORCH-1282 media-url-fetchable gate passed.");
