#!/usr/bin/env node
/**
 * #1719 semantic cover-writer inventory.
 *
 * The invariant is a rule, not a remembered file list: every production write
 * of cover_media_url must carry cover_media_poster_url in the same write, RPC
 * argument block, or mutable patch object. GIF/video cannot reach a public
 * share surface without a stable still.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ROOTS = ['mingla-business/src', 'supabase/functions'];
const EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);
const EXCLUDED = new Set(['node_modules', '__tests__', 'test', 'tests', 'fixtures', 'generated']);

function walk(directory, output = []) {
  if (!fs.existsSync(directory)) return output;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (EXCLUDED.has(entry.name) || entry.name.endsWith('.test.ts') || entry.name.endsWith('.test.tsx')) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolute, output);
    else if (EXTENSIONS.has(path.extname(entry.name))) output.push(absolute);
  }
  return output;
}

function lineAt(source, index) {
  return source.slice(0, index).split('\n').length;
}

function balancedSlice(source, openIndex, openCharacter, closeCharacter) {
  let depth = 0;
  let quote = null;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== null) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
    if (character === openCharacter) depth += 1;
    if (character === closeCharacter) {
      depth -= 1;
      if (depth === 0) return source.slice(openIndex, index + 1);
    }
  }
  return source.slice(openIndex);
}

export function findCoverWriterViolations(source, relativePath = 'unknown.ts') {
  const findings = [];
  const seen = new Set();
  const add = (index, kind) => {
    const key = `${index}:${kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({ path: relativePath, line: lineAt(source, index), kind });
  };

  for (const match of source.matchAll(/\.(?:insert|update|upsert)\s*\(\s*\{/g)) {
    const open = source.indexOf('{', match.index);
    const block = balancedSlice(source, open, '{', '}');
    if (/\bcover_media_url\s*:/.test(block) && !/\bcover_media_poster_url\s*:/.test(block)) {
      add(match.index, 'object-write-without-poster');
    }
  }

  for (const match of source.matchAll(/\.rpc\s*\(/g)) {
    const open = source.indexOf('(', match.index);
    const block = balancedSlice(source, open, '(', ')');
    if (/\bp_cover_media_url\s*:/.test(block) && !/\bp_cover_media_poster_url\s*:/.test(block)) {
      add(match.index, 'rpc-write-without-poster');
    }
  }

  for (const match of source.matchAll(/\b([A-Za-z_$][\w$]*)\.cover_media_url\s*=(?!=)/g)) {
    const objectName = match[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp(`\\b${objectName}\\.cover_media_poster_url\\s*=`).test(source)) {
      add(match.index, 'mutable-patch-without-poster');
    }
  }
  return findings;
}

export function scanCoverWriters(root = ROOT) {
  return ROOTS.flatMap((relativeRoot) => walk(path.join(root, relativeRoot)))
    .flatMap((absolute) => findCoverWriterViolations(fs.readFileSync(absolute, 'utf8'), path.relative(root, absolute)));
}

export function assertCoverWriterInventory(findings) {
  if (findings.length === 0) return { violations: 0 };
  const sample = findings.slice(0, 30).map((item) => `${item.kind}@${item.path}:${item.line}`).join(', ');
  throw new Error(`cover writer missing stable poster: ${sample}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const findings = scanCoverWriters();
  const result = assertCoverWriterInventory(findings);
  console.log(JSON.stringify({ ok: true, ...result }));
}
