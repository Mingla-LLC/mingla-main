#!/usr/bin/env node
/**
 * #1615 semantic inventory gate.
 *
 * This walks every production source file under every shipped surface. It does
 * not trust a remembered producer filename list. During the staged migration,
 * legacy signature ceilings remain only for non-RN transports. Direct native
 * calls are classified structurally: content adapters/transports declare their
 * role, while every other call declares its non-content purpose at the callsite.
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
const NON_CONTENT_CLASSIFICATION = /^\s*\/\/\s*SHARE-NON-CONTENT:(?:invite|file-export)\s*$/;
const SIGNATURES = Object.freeze({
  react_native_share: /\bShare\.share\s*\(/g,
  browser_share: /\bnavigator\.share\s*\(/g,
  whatsapp_intent: /(?:https?:\/\/)?wa\.me\//g,
  sms_intent: /\bsms:/g,
  x_share_intent: /(?:twitter\.com\/intent\/tweet|x\.com\/intent\/post)/g,
  appsflyer_content_payload: /deep_link_(?:value|sub\d+)/g,
  inline_short_content_url: /usemingla\.com\/s\//g,
});

// [TEST-MOD-APPROVED #1615] Stage 6 removed every direct content Share.share;
// the remaining six are explicitly non-content invitations/file exports.
// Typed adapters and the generic business platform transport are excluded by
// role, so any new direct content construction now fails.
const LEGACY_SIGNATURE_CEILINGS = Object.freeze({
  react_native_share: 0,
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
  if (hasEvidenceBearingRole(source)) return [];
  const sourceLines = source.split('\n');
  const scannedSource = maskComments(source);
  const findings = [];
  for (const [signature, expression] of Object.entries(SIGNATURES)) {
    expression.lastIndex = 0;
    for (const match of scannedSource.matchAll(expression)) {
      const line = scannedSource.slice(0, match.index).split('\n').length;
      if (signature === 'react_native_share') {
        const nearby = sourceLines.slice(Math.max(0, line - 4), line - 1);
        if (nearby.some((candidate) => NON_CONTENT_CLASSIFICATION.test(candidate))) continue;
      }
      findings.push({ signature, path: relativePath, line });
    }
  }
  return findings;
}

function hasEvidenceBearingRole(source) {
  if (/^\s*\/\/\s*SHARE-SEMANTIC-ROLE:content-adapter\s*$/m.test(source)) {
    return /from\s+['"]@mingla\/sharing['"]/.test(source)
      && /\bbuildShareMessage\s*\(/.test(source)
      && /\bbuildShortShareUrl\s*\(/.test(source);
  }
  if (/^\s*\/\/\s*SHARE-SEMANTIC-ROLE:content-transport\s*$/m.test(source)) {
    const contentAware = /\b(?:kind|identity|shortCode|ShareFacts|content_share_v1)\b|usemingla\.com|\/s\//.test(maskComments(source));
    const preparedFields = /\btitle\b/.test(source) && /\burl\b/.test(source) && /\bShare\.share\s*\(/.test(maskComments(source));
    return !contentAware && preparedFields;
  }
  return false;
}

function maskComments(source) {
  let output = '';
  let state = 'code';
  let quote = '';
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (state === 'line-comment') {
      if (current === '\n') { state = 'code'; output += '\n'; } else output += ' ';
    } else if (state === 'block-comment') {
      if (current === '*' && next === '/') { output += '  '; index += 1; state = 'code'; }
      else output += current === '\n' ? '\n' : ' ';
    } else if (state === 'string') {
      output += current;
      if (current === '\\') { output += next ?? ''; index += 1; }
      else if (current === quote) state = 'code';
    } else if (current === '/' && next === '/') {
      output += '  '; index += 1; state = 'line-comment';
    } else if (current === '/' && next === '*') {
      output += '  '; index += 1; state = 'block-comment';
    } else {
      output += current;
      if (current === '"' || current === "'" || current === '`') { state = 'string'; quote = current; }
    }
  }
  return output;
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
