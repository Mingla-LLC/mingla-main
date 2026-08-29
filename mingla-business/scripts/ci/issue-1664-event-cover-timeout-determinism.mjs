#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// [TEST-MOD-APPROVED #2715] Historical filename retained; contract now proves
// durable processing beyond the removed client deadline.
const TEST_NAME = "keeps the same processing job alive beyond the former deadline and later resolves";
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const testPath = path.resolve(
  scriptDirectory,
  "../../src/services/__tests__/eventCoverVideoProcessingService.test.ts",
);

function stripComments(source) {
  let output = "";
  let state = "code";
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "line-comment") {
      if (character === "\n") {
        output += "\n";
        state = "code";
      } else {
        output += " ";
      }
      continue;
    }

    if (state === "block-comment") {
      if (character === "*" && next === "/") {
        output += "  ";
        index += 1;
        state = "code";
      } else {
        output += character === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (state !== "code") {
      output += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (
        (state === "single-quote" && character === "'") ||
        (state === "double-quote" && character === '"') ||
        (state === "template" && character === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      state = "line-comment";
    } else if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      state = "block-comment";
    } else {
      output += character;
      if (character === "'") state = "single-quote";
      if (character === '"') state = "double-quote";
      if (character === "`") state = "template";
    }
  }

  return output;
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let state = "code";
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];

    if (state !== "code") {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (
        (state === "single-quote" && character === "'") ||
        (state === "double-quote" && character === '"') ||
        (state === "template" && character === "`")
      ) {
        state = "code";
      }
      continue;
    }

    if (character === "'") state = "single-quote";
    else if (character === '"') state = "double-quote";
    else if (character === "`") state = "template";
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function isolateTargetBlock(source) {
  const executableSource = stripComments(source);
  const escapedName = TEST_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const targetPattern = new RegExp(
    `\\btest\\s*\\(\\s*(["'])${escapedName}\\1\\s*,\\s*async\\s*\\(\\s*\\)\\s*=>\\s*\\{`,
    "g",
  );
  const matches = [...executableSource.matchAll(targetPattern)];
  if (matches.length !== 1) {
    throw new Error(`expected exactly one executable target test, found ${matches.length}`);
  }

  const match = matches[0];
  const openIndex = match.index + match[0].lastIndexOf("{");
  const closeIndex = findMatchingBrace(executableSource, openIndex);
  if (closeIndex === -1) throw new Error("target test callback has no matching closing brace");
  return executableSource.slice(openIndex + 1, closeIndex);
}

function countMatches(source, pattern) {
  return [...source.matchAll(pattern)].length;
}

function inspectContract(source) {
  let block;
  try {
    block = isolateTargetBlock(source);
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }

  const errors = [];
  const requirePattern = (description, pattern) => {
    if (!pattern.test(block)) errors.push(description);
  };

  requirePattern(
    "fake timers must start at an explicit zero clock",
    /jest\.useFakeTimers\s*\(\s*\{[\s\S]*?\bnow\s*:\s*0\b[\s\S]*?\}\s*\)/,
  );
  requirePattern("the clock must advance beyond the historical 120-second deadline", /await\s+jest\.advanceTimersByTimeAsync\s*\(\s*1_105_000\s*\)/);
  requirePattern(
    "real timers must be restored from a finally block",
    /finally\s*\{[\s\S]*?jest\.useRealTimers\s*\(\s*\)\s*;?[\s\S]*?\}/,
  );
  requirePattern(
    "the test must include a transient status failure",
    /\binvoke[\s\S]*?\.mockRejectedValueOnce\s*\(/,
  );
  requirePattern("pollIntervalMs must remain exactly 1", /\bpollIntervalMs\s*:\s*1\b/);
  requirePattern("unknown processing progress must be null", /\bprogressPercent\s*:\s*null\b/);
  requirePattern("later server truth must resolve ready", /expect\s*\(\s*waitPromise\s*\)\.resolves\.toMatchObject\s*\([\s\S]*?status\s*:\s*["']ready["']/);
  requirePattern(
    "callback evidence must retain processing then observe ready",
    /expect\s*\(\s*seen\s*\)\.toEqual\s*\(\s*\[\s*["']processing["']\s*,\s*["']ready["']\s*\]\s*\)/,
  );
  requirePattern("the same three status attempts must be asserted", /expect\s*\(\s*invoke\s*\)\.toHaveBeenCalledTimes\s*\(\s*3\s*\)/);

  if (/processing_timeout|\.rejects\b|progressPercent\s*:\s*70\b/.test(block)) errors.push("terminal client timeout/fabricated progress is forbidden");
  if (/\b(?:test|it)\s*\.\s*(?:skip|only)\b|\bjest\.retryTimes\s*\(/.test(block)) {
    errors.push("skip, only, and retry APIs are forbidden in the target test");
  }
  if (/\b(?:child_process|worker_threads|runInBand|testSequencer|spawnSync|execSync)\b/.test(block)) {
    errors.push("worker or process scheduling escapes are forbidden in the target test");
  }
  if (countMatches(block, /\bpollIntervalMs\s*:/g) !== 1) {
    errors.push("the target test must contain exactly one pollIntervalMs input");
  }
  return errors;
}

const canonicalFixture = String.raw`
test("${TEST_NAME}", async () => {
  // [TEST-MOD-APPROVED #2715]
  jest.useFakeTimers({ now: 0 });
  try {
    invoke
      .mockResolvedValueOnce({ data: { status: "processing", progressPercent: null }, error: null })
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ data: { status: "ready" }, error: null });
    const seen = [];
    const waitPromise = waitForEventCoverVideoReady("job_1", {
      onStatus: (status) => seen.push(status.status),
      pollIntervalMs: 1,
    });
    await jest.advanceTimersByTimeAsync(1_105_000);
    await expect(waitPromise).resolves.toMatchObject({ status: "ready" });
    expect(seen).toEqual(["processing", "ready"]);
    expect(invoke).toHaveBeenCalledTimes(3);
  } finally {
    jest.useRealTimers();
  }
});`;

const historicalFixture = String.raw`
test("${TEST_NAME}", async () => {
  jest.useFakeTimers({ now: 0 });
  invoke.mockResolvedValue({ data: { status: "processing", progressPercent: 70 }, error: null });
  const waitPromise = waitForEventCoverVideoReady("job_1", { pollIntervalMs: 1, timeoutMs: 2 });
  await jest.advanceTimersByTimeAsync(2);
  await expect(waitPromise).rejects.toMatchObject({ code: "processing_timeout" });
  jest.useRealTimers();
});`;

function runSelfTest() {
  const cases = [
    { name: "canonical repaired block", source: canonicalFixture, shouldPass: true },
    { name: "exact historical arrangement", source: historicalFixture, shouldPass: false },
    {
      name: "stable mock without fake clock",
      source: canonicalFixture.replace("jest.useFakeTimers({ now: 0 });", ""),
      shouldPass: false,
    },
    {
      name: "fake clock without long async advancement",
      source: canonicalFixture.replace("await jest.advanceTimersByTimeAsync(1_105_000);", ""),
      shouldPass: false,
    },
    {
      name: "cleanup outside finally",
      source: canonicalFixture.replace("  } finally {\n    jest.useRealTimers();\n  }", "  }\n  jest.useRealTimers();"),
      shouldPass: false,
    },
    {
      name: "fabricated progress",
      source: canonicalFixture.replace("progressPercent: null", "progressPercent: 70"),
      shouldPass: false,
    },
    {
      name: "one-shot replies with superficial comment tokens",
      source: historicalFixture.replace(
        `test("${TEST_NAME}", async () => {`,
        `test("${TEST_NAME}", async () => {\n  // jest.useFakeTimers({ now: 0 }); await jest.advanceTimersByTimeAsync(1_105_000); finally { jest.useRealTimers(); } mockRejectedValueOnce(); expect(invoke).toHaveBeenCalledTimes(3);`,
      ),
      shouldPass: false,
    },
    {
      name: "skipped target",
      source: canonicalFixture.replace("test(\"", "test.skip(\""),
      shouldPass: false,
    },
    {
      name: "required invocation-count assertion removed",
      source: canonicalFixture.replace("    expect(invoke).toHaveBeenCalledTimes(3);\n", ""),
      shouldPass: false,
    },
  ];

  let failed = false;
  for (const testCase of cases) {
    const errors = inspectContract(testCase.source);
    const passed = errors.length === 0;
    if (passed !== testCase.shouldPass) {
      failed = true;
      console.error(
        `FAIL self-test: ${testCase.name} unexpectedly ${passed ? "passed" : `failed (${errors.join("; ")})`}`,
      );
    }
  }

  if (failed) process.exit(1);
  console.log(`PASS #2715 durable-processing contract self-test (${cases.length} fixtures)`);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const source = fs.readFileSync(testPath, "utf8");
  const errors = inspectContract(source);
  if (errors.length > 0) {
    console.error("FAIL #2715 event-cover durable-processing determinism contract:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("PASS #2715 event-cover durable-processing determinism contract");
}
