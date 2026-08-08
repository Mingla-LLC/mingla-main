#!/usr/bin/env node
/**
 * #1615 semantic inventory gate.
 *
 * This walks every production source file under every shipped surface. It does
 * not trust a remembered producer filename list. During the staged migration,
 * the aggregate legacy signature ceilings below are transitional debt; stage 6
 * removes them when all content producers use the two approved adapters.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_ROOTS = [
  'app-mobile/app', 'app-mobile/src',
  'mingla-business/app', 'mingla-business/api', 'mingla-business/server', 'mingla-business/src',
  'mingla-marketing/app', 'mingla-marketing/lib', 'supabase/functions',
];
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const EXCLUDED_SEGMENTS = new Set(['node_modules', '__tests__', 'playwright', 'maestro', '.next', 'dist', 'build']);
const APPROVED_ADAPTER_SUFFIXES = Object.freeze([
  '/sharePayloadAdapter.ts', '/sharePayloadAdapter.tsx', '/sharePayloadAdapter.js',
  '/contentShareService.ts', '/contentShareService.js',
]);
const SIGNATURES = Object.freeze({
  react_native_share: /\bShare\.share\s*\(/g,
  browser_share: /\bnavigator\.share\s*\(/g,
  whatsapp_intent: /(?:https?:\/\/)?wa\.me\//g,
  sms_intent: /\bsms:/g,
  x_share_intent: /(?:twitter\.com\/intent\/tweet|x\.com\/intent\/post)/g,
  appsflyer_content_payload: /deep_link_(?:value|sub\d+)/g,
  inline_short_content_url: /usemingla\.com\/s\//g,
});

// [TRANSITIONAL #1615 stage 1 -> stage 6] Aggregate ceilings preserve the
// existing production inventory without blessing any path. New occurrences in
// any current or newly-created production file fail this gate immediately.
const LEGACY_SIGNATURE_CEILINGS = Object.freeze({
  react_native_share: 18,
  browser_share: 0,
  whatsapp_intent: 1,
  sms_intent: 58,
  x_share_intent: 2,
  appsflyer_content_payload: 51,
  inline_short_content_url: 0,
});

function walk(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) output.push(absolute);
  }
  return output;
}

export function findUnauthorizedConstructs(source, relativePath = 'unknown.ts') {
  const normalized = `/${relativePath.replaceAll(path.sep, '/')}`;
  if (APPROVED_ADAPTER_SUFFIXES.some((suffix) => normalized.endsWith(suffix))) return [];
  const findings = [];
  for (const [signature, expression] of Object.entries(SIGNATURES)) {
    expression.lastIndex = 0;
    for (const match of source.matchAll(expression)) {
      const line = source.slice(0, match.index).split('\n').length;
      findings.push({ signature, path: relativePath, line });
    }
  }
  return findings;
}

export function scanProductionSources(root = ROOT) {
  return SOURCE_ROOTS.flatMap((relativeRoot) => walk(path.join(root, relativeRoot)))
    .flatMap((absolute) => findUnauthorizedConstructs(fs.readFileSync(absolute, 'utf8'), path.relative(root, absolute)));
}

export function assertSemanticInventory(findings, ceilings = LEGACY_SIGNATURE_CEILINGS) {
  const counts = Object.fromEntries(Object.keys(SIGNATURES).map((key) => [key, 0]));
  for (const finding of findings) counts[finding.signature] += 1;
  const excess = Object.entries(counts).filter(([key, count]) => count > (ceilings[key] ?? 0));
  if (excess.length) {
    const details = excess.map(([key, count]) => `${key}=${count} (ceiling ${ceilings[key] ?? 0})`).join(', ');
    throw new Error(`unauthorized content-share construction: ${details}`);
  }
  return counts;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = scanProductionSources();
  try {
    const counts = assertSemanticInventory(findings);
    console.log(JSON.stringify({ ok: true, counts }));
  } catch (error) {
    const counts = Object.fromEntries(Object.keys(SIGNATURES).map((key) => [key, findings.filter((item) => item.signature === key).length]));
    console.error(JSON.stringify({ ok: false, counts, sample: findings.slice(0, 30) }, null, 2));
    throw error;
  }
}

export { LEGACY_SIGNATURE_CEILINGS, SIGNATURES };
