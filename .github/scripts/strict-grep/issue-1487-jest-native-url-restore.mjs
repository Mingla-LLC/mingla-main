#!/usr/bin/env node

// #1487 — Jest creates a fresh environment for each suite, but suites in one
// worker still expose Node's URL constructor object. A test that deletes or
// overwrites URL.createObjectURL therefore poisons every later suite in that
// worker. Tests may borrow the native only through jest.spyOn(...), whose
// restore lifecycle returns ownership to Node.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? path.resolve(process.cwd(), "..")
  : process.cwd();

const STRING_MARKER = "__ISSUE1487_CREATE_OBJECT_URL__";
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".cjs", ".mjs"]);
const EXCLUDED_SEGMENTS = new Set([
  "node_modules",
  "build",
  "dist",
  "coverage",
  ".expo",
  ".next",
  ".cache",
  "cache",
  "generated",
  "output",
  "outputs",
  "web-build",
]);
const URL_RECEIVER = String.raw`(?<![\w$.])(?:\(\s*)*(?:globalThis\s*\.\s*)?URL\b[^,;]{0,240}`;

const deletePattern = new RegExp(
  String.raw`\bdelete\b\s+${URL_RECEIVER}(?:\.\s*createObjectURL|\[\s*["']${STRING_MARKER}["']\s*\])`,
  "m",
);
const directAssignmentPattern = new RegExp(
  String.raw`${URL_RECEIVER}(?:\.\s*createObjectURL|\[\s*["']${STRING_MARKER}["']\s*\])\s*(?:=(?!=|>)|\+=|-=|\*=|\/=|&&=|\|\|=|\?\?=)`,
  "m",
);
const objectAssignPattern = new RegExp(
  String.raw`\bObject\s*\.\s*assign\s*\(\s*${URL_RECEIVER},\s*\{[^}]{0,500}?(?:\bcreateObjectURL\b|["']${STRING_MARKER}["'])\s*:`,
  "m",
);
const definePropertyPattern = new RegExp(
  String.raw`\bObject\s*\.\s*defineProperty\s*\(\s*${URL_RECEIVER},\s*["']${STRING_MARKER}["']\s*,`,
  "m",
);

function maskCommentsAndStrings(source) {
  let output = "";
  let index = 0;
  while (index < source.length) {
    const current = source[index];
    const next = source[index + 1];

    if (current === "/" && next === "/") {
      index += 2;
      while (index < source.length && source[index] !== "\n") index += 1;
      output += "\n";
      if (source[index] === "\n") index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      index += 2;
      while (index < source.length && !(source[index] === "*" && source[index + 1] === "/")) {
        if (source[index] === "\n") output += "\n";
        index += 1;
      }
      index = Math.min(index + 2, source.length);
      output += " ";
      continue;
    }
    if (current === '"' || current === "'") {
      const quote = current;
      let value = "";
      index += 1;
      while (index < source.length && source[index] !== quote) {
        if (source[index] === "\\" && index + 1 < source.length) {
          value += source[index + 1];
          index += 2;
          continue;
        }
        value += source[index];
        index += 1;
      }
      if (index < source.length) index += 1;
      output += value === "createObjectURL" ? `"${STRING_MARKER}"` : '""';
      continue;
    }
    if (current === "`") {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\" && index + 1 < source.length) {
          index += 2;
          continue;
        }
        if (source[index] === "`") {
          index += 1;
          break;
        }
        if (source[index] === "\n") output += "\n";
        index += 1;
      }
      output += '""';
      continue;
    }

    output += current;
    index += 1;
  }
  return output;
}

function isBusinessTestPath(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  if (!normalized.startsWith("mingla-business/")) return false;
  const segments = normalized.split("/");
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false;
  if (!SOURCE_EXTENSIONS.has(path.extname(normalized))) return false;
  const basename = path.basename(normalized);
  return segments.includes("__tests__") || /\.(?:test|spec)\.[^.]+$/.test(basename);
}

function inspectEntry({ relativePath, source }) {
  if (!isBusinessTestPath(relativePath)) return [];
  const activeSource = maskCommentsAndStrings(source);
  const findings = [];
  if (deletePattern.test(activeSource)) findings.push("delete");
  if (directAssignmentPattern.test(activeSource)) findings.push("direct assignment");
  if (objectAssignPattern.test(activeSource)) findings.push("Object.assign");
  if (definePropertyPattern.test(activeSource)) findings.push("Object.defineProperty");
  return findings;
}

function walk(directory, entries, failures) {
  let directoryEntries;
  try {
    directoryEntries = fs.readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    failures.push(`${path.relative(root, directory) || directory}: cannot read directory (${error.message})`);
    return;
  }

  for (const entry of directoryEntries) {
    if (EXCLUDED_SEGMENTS.has(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolutePath, entries, failures);
      continue;
    }
    const relativePath = path.relative(root, absolutePath);
    if (!isBusinessTestPath(relativePath)) continue;
    try {
      entries.push({ relativePath, source: fs.readFileSync(absolutePath, "utf8") });
    } catch (error) {
      failures.push(`${relativePath}: cannot read file (${error.message})`);
    }
  }
}

function collectEntries(repoRoot, failures) {
  const entries = [];
  walk(path.join(repoRoot, "mingla-business"), entries, failures);
  return entries;
}

function runSelfTest() {
  const errors = [];
  const testPath = "mingla-business/src/example/__tests__/issue1487.test.ts";
  const good = [
    `jest.spyOn(URL, "createObjectURL").mockReturnValue("blob:safe");`,
    `const value = URL.createObjectURL(blob); URL.revokeObjectURL(value);`,
    `// delete URL.createObjectURL;\n/* Object.defineProperty(URL, "createObjectURL", {}); */`,
    `const prose = "delete URL.createObjectURL; Object.assign(URL, { createObjectURL: fn });";`,
    `URL.createObjectURLs = replacement; const x = URL.notCreateObjectURL;`,
    `const same = URL.createObjectURL === original; expect(URL.createObjectURL).toBe(original);`,
    `Object.assign({ URL }, { createObjectURL: replacement });`,
    `Object.defineProperty(other.URL, "createObjectURL", { value: replacement });`,
  ];
  good.forEach((source, index) => {
    const findings = inspectEntry({ relativePath: testPath, source });
    if (findings.length) errors.push(`GOOD-${index + 1} wrongly flagged: ${findings.join(", ")}`);
  });

  const bad = [
    ["delete-dot", `delete URL.createObjectURL;`, "delete"],
    [
      "delete-cast-multiline",
      `delete (URL as unknown as { createObjectURL?: unknown })\n  .createObjectURL;`,
      "delete",
    ],
    ["delete-bracket", `delete (globalThis.URL)["createObjectURL"];`, "delete"],
    ["direct-assignment", `(URL as typeof URL).createObjectURL = replacement;`, "direct assignment"],
    ["direct-bracket", `URL["createObjectURL"] ||= replacement;`, "direct assignment"],
    [
      "object-assign",
      `Object.assign(\n  URL,\n  { createObjectURL: replacement },\n);`,
      "Object.assign",
    ],
    [
      "define-property",
      `Object.defineProperty(\n URL,\n "createObjectURL",\n { value: replacement },\n);`,
      "Object.defineProperty",
    ],
  ];
  bad.forEach(([name, source, expected]) => {
    const findings = inspectEntry({ relativePath: testPath, source });
    if (!findings.includes(expected)) errors.push(`BAD-${name} was not flagged as ${expected}`);
  });

  const excluded = inspectEntry({
    relativePath: "mingla-business/node_modules/pkg/__tests__/bad.test.ts",
    source: "delete URL.createObjectURL;",
  });
  if (excluded.length) errors.push("path exclusion failed for node_modules");
  const nonTest = inspectEntry({
    relativePath: "mingla-business/src/runtime.ts",
    source: "delete URL.createObjectURL;",
  });
  if (nonTest.length) errors.push("non-test path was scanned");

  const missingFailures = [];
  collectEntries(path.join(root, "__issue_1487_missing_fixture__"), missingFailures);
  if (missingFailures.length === 0) errors.push("missing-directory fixture did not fail closed");

  if (errors.length) {
    console.error("issue-1487 native URL restoration self-test FAIL:");
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }
  console.log("issue-1487 native URL restoration self-test PASS (GOOD/BAD/path/fail-closed arms)." );
  process.exit(0);
}

if (process.argv.includes("--self-test")) runSelfTest();

const failures = [];
const entries = collectEntries(root, failures);
if (entries.length === 0) failures.push("no Business test files were found; refusing a vacuous pass");
for (const entry of entries) {
  const findings = inspectEntry(entry);
  if (findings.length) {
    failures.push(
      `${entry.relativePath}: destructively mutates Node's native URL.createObjectURL via ${findings.join(", ")}; ` +
        `use jest.spyOn(URL, "createObjectURL") and jest.restoreAllMocks() (#1487)`,
    );
  }
}

if (failures.length) {
  console.error("issue-1487 native URL restoration gate FAIL:");
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`issue-1487 native URL restoration gate PASS (${entries.length} Business test files scanned).`);
