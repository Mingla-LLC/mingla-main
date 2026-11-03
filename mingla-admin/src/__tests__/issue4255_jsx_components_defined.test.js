// #4255: every capitalised JSX tag in admin source must be imported or declared in its file.
// A missing import (BlogLinkPicker in BlogBlockList) crashed every blog draft at render time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "..");

function jsxFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" || name === "node_modules" ? [] : jsxFiles(path);
    return /\.(jsx|js)$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

function stripStringsAndComments(source) {
  return source
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}

export function undefinedJsxTags(source) {
  const code = stripStringsAndComments(source);
  const declared = new Set();
  for (const m of code.matchAll(/import\s+([\s\S]*?)\s+from\s/g)) {
    for (const id of m[1].replace(/[{}*]/g, " ").split(/[\s,]+/)) if (id && id !== "as" && id !== "type") declared.add(id);
  }
  for (const m of code.matchAll(/\b(?:function|class|const|let|var)\s+([A-Z][A-Za-z0-9_]*)/g)) declared.add(m[1]);
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\{([^}]*)\}\s*=/g)) {
    for (const part of m[1].split(",")) {
      const id = part.split(":").pop().split("=")[0].trim();
      if (id) declared.add(id);
    }
  }
  for (const m of code.matchAll(/\b(?:const|let|var)\s*\[([^\]]*)\]\s*=/g)) {
    for (const id of m[1].split(/[\s,]+/)) if (id) declared.add(id.split("=")[0]);
  }
  // Props and params renamed to a component, e.g. ({ icon: Icon }) or (Comp) =>.
  for (const m of code.matchAll(/:\s*([A-Z][A-Za-z0-9_]*)\s*[,}=]/g)) declared.add(m[1]);
  for (const m of code.matchAll(/\(\s*([A-Z][A-Za-z0-9_]*)\s*[,)]/g)) declared.add(m[1]);
  const used = new Set();
  for (const m of code.matchAll(/<([A-Z][A-Za-z0-9_]*)[\s/>]/g)) used.add(m[1]);
  return [...used].filter((tag) => !declared.has(tag)).sort();
}

test("undefinedJsxTags flags a component used without an import", () => {
  assert.deepEqual(undefinedJsxTags('import { Modal } from "./Modal";\nexport const A = () => <Modal><BlogLinkPicker /></Modal>;'), ["BlogLinkPicker"]);
  assert.deepEqual(undefinedJsxTags('import { BlogLinkPicker } from "./BlogLinkPicker";\nexport const A = () => <BlogLinkPicker />;'), []);
});

test("every admin component tag resolves to an import or local declaration", () => {
  const offenders = jsxFiles(SRC)
    .map((file) => ({ file: file.slice(SRC.length + 1), tags: undefinedJsxTags(readFileSync(file, "utf8")) }))
    .filter((entry) => entry.tags.length);
  assert.deepEqual(offenders, []);
});
