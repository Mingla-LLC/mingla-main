#!/usr/bin/env node
/**
 * #1615 semantic inventory gate.
 *
 * This walks the repository and excludes non-production material by rule. It
 * does not trust a remembered root or producer filename list. Every direct
 * share transport call is classified at that callsite; a role tag elsewhere in
 * the same file cannot pardon an additional raw producer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const EXCLUDED_SEGMENTS = new Set([
  '.git', '.github', '.next', '.expo', '.turbo', 'android', 'ios', 'build',
  'coverage', 'dist', 'docs', 'fixtures', 'generated', 'maestro', 'node_modules',
  'playwright', 'scripts', 'test', 'tests', '__mocks__', '__tests__', 'vendor',
  'web-build',
]);
const NON_CONTENT_CLASSIFICATION = /^\s*\/\/\s*SHARE-NON-CONTENT:(?:invite|file-export)\s*$/;
const CONTENT_CALL_CLASSIFICATION = /^\s*\/\/\s*SHARE-CONTENT-CALL:(?:adapter|transport)\s*$/;
const CANONICAL_URL_CLASSIFICATION = /^\s*\/\/\s*SHARE-CANONICAL-URL-BUILDER\s*$/;
const SIGNATURES = Object.freeze({
  react_native_share: /\bShare\.share\s*\(/g,
  browser_share: /\bnavigator\.share\s*\(/g,
  whatsapp_intent: /(?:https?:\/\/)?wa\.me\//g,
  sms_intent: /\bsms:/g,
  x_share_intent: /(?:twitter\.com\/intent\/tweet|x\.com\/intent\/post)/g,
  appsflyer_content_payload: /deep_link_(?:value|sub\d+)/g,
  inline_short_content_url: /usemingla\.com\/s\//g,
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
  const sourceLines = source.split('\n');
  const scannedSource = maskComments(source);
  const findings = [];
  for (const [signature, expression] of Object.entries(SIGNATURES)) {
    expression.lastIndex = 0;
    for (const match of scannedSource.matchAll(expression)) {
      const line = scannedSource.slice(0, match.index).split('\n').length;
      // Exact callsite exemption: only the call line or immediately preceding
      // line qualifies. A file-level or distant tag cannot bless another call.
      const nearby = sourceLines.slice(Math.max(0, line - 2), line);
      const exactNonContent = nearby.some((candidate) => NON_CONTENT_CLASSIFICATION.test(candidate));
      const exactContentCall = nearby.some((candidate) => CONTENT_CALL_CLASSIFICATION.test(candidate));
      const exactCanonicalBuilder = nearby.some((candidate) => CANONICAL_URL_CLASSIFICATION.test(candidate));
      if (exactNonContent && signature === 'react_native_share') continue;
      if (exactContentCall && isAuthorizedContentCall(source, signature)) continue;
      if (signature === 'inline_short_content_url' && exactCanonicalBuilder
        && (/function\s+buildShortShareUrl\s*\(/.test(source)
          || (/canonicalUrl\s*:/.test(source) && /CONTENT_SHARE_RE/.test(source)))) continue;

      // Phone/auth SMS links, attribution payload parsers, and ordinary social
      // links are not content producers by themselves. They become relevant
      // only when their local statement/window also constructs Mingla content.
      if (!['react_native_share', 'browser_share', 'inline_short_content_url'].includes(signature)) {
        const window = sourceLines.slice(Math.max(0, line - 3), line + 3).join('\n');
        if (!/buildShareMessage|buildShortShareUrl|content_share_v1|shortCode|usemingla\.com\/s\//.test(window)) continue;
      }
      findings.push({ signature, path: relativePath, line });
    }
  }
  return findings;
}

function isAuthorizedContentCall(source, signature) {
  if (signature === 'react_native_share' || signature === 'browser_share') {
    if (/^\s*\/\/\s*SHARE-SEMANTIC-ROLE:content-adapter\s*$/m.test(source)) {
      // [TEST-MOD-APPROVED #1719] Written reason: #1719 removed client-side
      // message construction. A canonical adapter must now consume the
      // server-authored immutable `data.message`; requiring buildShareMessage
      // would force the exact second formatter the binding spec forbids.
      const serverAuthoredMessage = /\bmessage:\s*data\.message\b/.test(source)
        && !/\bbuildShareMessage\s*\(/.test(source);
      return /from\s+['"]@mingla\/sharing['"]/.test(source)
      && serverAuthoredMessage
      && /\bbuildShortShareUrl\s*\(/.test(source);
    }
    if (/^\s*\/\/\s*SHARE-SEMANTIC-ROLE:content-transport\s*$/m.test(source)) {
      const contentAware = /\b(?:kind|identity|shortCode|ShareFacts|content_share_v1)\b|usemingla\.com|\/s\//.test(maskComments(source));
      const preparedFields = /\btitle\b/.test(source) && /\burl\b/.test(source);
      return !contentAware && preparedFields;
    }
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
  return walk(root)
    .flatMap((absolute) => findUnauthorizedConstructs(fs.readFileSync(absolute, 'utf8'), path.relative(root, absolute)));
}

export function assertSemanticInventory(findings) {
  const counts = Object.fromEntries(Object.keys(SIGNATURES).map((key) => [key, 0]));
  for (const finding of findings) counts[finding.signature] += 1;
  if (findings.length) {
    const sample = findings.slice(0, 20).map((finding) => `${finding.signature}@${finding.path}:${finding.line}`).join(', ');
    throw new Error(`unauthorized content-share construction: ${sample}`);
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

export { SIGNATURES };
