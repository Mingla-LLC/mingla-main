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
 *   (2) compose.tsx: media URLs come from uploadMarketingMmsImage (the verified
 *       upload), the payload uses `media_urls: mmsMediaUrls`, and mmsMediaUrls is
 *       DERIVED from the verified `remoteUrl` values ONLY — a LOCAL blob/file
 *       preview uri is NEVER written into media_urls.
 *
 * ORCH-1289 (2026-07-03) — AMENDED for the multi-select refactor: compose.tsx
 * now models each photo as an item {localUri, remoteUrl, …} and DERIVES
 * mmsMediaUrls (verified `remoteUrl`s) instead of the old `setMmsMediaUrls([url])`
 * single-item setter. The invariant is unchanged: only verified public URLs
 * reach the payload; no local uri ever does.
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
  // The media URL(s) must come from the verified upload service.
  if (!/uploadMarketingMmsImage\s*\(/.test(code)) {
    failures.push(`${COMPOSE}: media URLs must come from uploadMarketingMmsImage() (the verified public URL). I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
  }
  // The payload must carry the verified array.
  if (!/media_urls:\s*mmsMediaUrls/.test(code)) {
    failures.push(`${COMPOSE}: the payload must carry media_urls: mmsMediaUrls (the verified array). I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
  }
  // mmsMediaUrls must be DERIVED from verified remoteUrl values only.
  if (!/mmsMediaUrls[\s\S]{0,240}remoteUrl/.test(code)) {
    failures.push(`${COMPOSE}: mmsMediaUrls must be derived from verified remoteUrl values only. I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
  }
  // A local blob/file preview uri must NEVER be written into media_urls.
  if (/media_urls:\s*\[?\s*\w*[lL]ocal(?:Uri|Uris)?/.test(code)) {
    failures.push(`${COMPOSE}: a local file:// / blob uri must NEVER reach media_urls. I-PROPOSED-1282-MMS-MEDIA-URL-PUBLICLY-FETCHABLE.`);
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
    setMmsMedia((prev) => prev.map((m) => (m.key === item.key ? { ...m, remoteUrl: url } : m)));
    const mmsMediaUrls = useMemo(() => mmsMedia.reduce((acc, m) => { if (m.remoteUrl !== null) acc.push(m.remoteUrl); return acc; }, []), [mmsMedia]);
    return { kind: "sms", body: smsBody, ...(mmsMediaUrls.length > 0 ? { media_urls: mmsMediaUrls } : {}) };
  `;
  // BAD_C: a local preview uri leaks into the payload (and no verified derivation).
  const CMP_BAD_C = `
    const url = await uploadMarketingMmsImage(brandId, input);
    return { kind: "sms", body: smsBody, media_urls: [mmsLocalUri] };
  `;
  // BAD_D: URL not sourced from the verified upload service.
  const CMP_BAD_D = `
    const mmsMediaUrls = useMemo(() => mmsMedia.map((m) => m.remoteUrl), [mmsMedia]);
    return { kind: "sms", body: smsBody, media_urls: mmsMediaUrls };
  `;
  const sg = evaluateService(SVC_GOOD), sa = evaluateService(SVC_BAD_A), sb = evaluateService(SVC_BAD_B);
  const cg = evaluateCompose(CMP_GOOD), cc = evaluateCompose(CMP_BAD_C), cd = evaluateCompose(CMP_BAD_D);
  const ok = sg.length === 0 && sa.length >= 1 && sb.length >= 1
    && cg.length === 0 && cc.length >= 1 && cd.length >= 1;
  if (!ok) {
    console.error("ORCH-1282 media-url-fetchable SELF-TEST failed:", { sg, sa, sb, cg, cc, cd });
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
