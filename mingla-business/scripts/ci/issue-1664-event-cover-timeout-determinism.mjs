#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const TEST_NAME = "waits with status callbacks and carries last status on timeout";
const EXACT_MESSAGE =
  "Your video is still processing. You can check again in a moment.";
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
  requirePattern(
    "the clock must advance asynchronously by exactly 2 ms",
    /await\s+jest\.advanceTimersByTimeAsync\s*\(\s*2\s*\)/,
  );
  requirePattern(
    "real timers must be restored from a finally block",
    /finally\s*\{[\s\S]*?jest\.useRealTimers\s*\(\s*\)\s*;?[\s\S]*?\}/,
  );
  requirePattern(
    "the status response must use a stable invoke.mockResolvedValue",
    /\binvoke\.mockResolvedValue\s*\(/,
  );
  requirePattern("pollIntervalMs must remain exactly 1", /\bpollIntervalMs\s*:\s*1\b/);
  requirePattern("timeoutMs must remain exactly 2", /\btimeoutMs\s*:\s*2\b/);
  requirePattern("processing_timeout assertion is required", /\bcode\s*:\s*["']processing_timeout["']/);
  requirePattern(
    "the exact timeout message assertion is required",
    new RegExp(`\\bmessage\\s*:\\s*["']${EXACT_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`),
  );
  requirePattern("lastStatus.jobId assertion is required", /\blastStatus\s*:\s*expect\.objectContaining\s*\([\s\S]*?\bjobId\s*:\s*["']job_1["']/);
  requirePattern("lastStatus.status assertion is required", /\blastStatus\s*:\s*expect\.objectContaining\s*\([\s\S]*?\bstatus\s*:\s*["']processing["']/);
  requirePattern(
    "callback evidence must assert at least one processing entry",
    /expect\s*\(\s*seen\.length\s*\)\.toBeGreaterThanOrEqual\s*\(\s*1\s*\)[\s\S]*?expect\s*\(\s*seen\s*\)\.toEqual\s*\(\s*\[\s*["']processing["']\s*,\s*["']processing["']\s*\]\s*\)/,
  );
  requirePattern(
    "invoke must be asserted exactly twice",
    /expect\s*\(\s*invoke\s*\)\.toHaveBeenCalledTimes\s*\(\s*2\s*\)/,
  );

  if (/\binvoke\.mockResolvedValueOnce\s*\(/.test(block)) {
    errors.push("one-shot invoke responses are forbidden in the target test");
  }
  if (/\b(?:test|it)\s*\.\s*(?:skip|only)\b|\bjest\.retryTimes\s*\(/.test(block)) {
    errors.push("skip, only, and retry APIs are forbidden in the target test");
  }
  if (/\b(?:child_process|worker_threads|runInBand|testSequencer|spawnSync|execSync)\b/.test(block)) {
    errors.push("worker or process scheduling escapes are forbidden in the target test");
  }
  if (countMatches(block, /\bpollIntervalMs\s*:/g) !== 1) {
    errors.push("the target test must contain exactly one pollIntervalMs input");
  }
  if (countMatches(block, /\btimeoutMs\s*:/g) !== 1) {
    errors.push("the target test must contain exactly one timeoutMs input");
  }

  const rejectionAssertionIndex = block.indexOf("const rejection = expect(waitPromise).rejects");
  const advanceIndex = block.indexOf("await jest.advanceTimersByTimeAsync(2)");
  const awaitRejectionIndex = block.indexOf("await rejection");
  if (
    rejectionAssertionIndex === -1 ||
    advanceIndex === -1 ||
    awaitRejectionIndex === -1 ||
    !(rejectionAssertionIndex < advanceIndex && advanceIndex < awaitRejectionIndex)
  ) {
    errors.push("the rejection assertion must attach before advancing time and be awaited afterward");
  }

  return errors;
}

const canonicalFixture = String.raw`
test("${TEST_NAME}", async () => {
  // #1664 protection
  jest.useFakeTimers({ now: 0 });
  try {
    invoke.mockResolvedValue({ data: { status: "processing" }, error: null });
    const seen = [];
    const waitPromise = waitForEventCoverVideoReady("job_1", {
      onStatus: (status) => seen.push(status.status),
      pollIntervalMs: 1,
      timeoutMs: 2,
    });
    const rejection = expect(waitPromise).rejects.toMatchObject({
      code: "processing_timeout",
      lastStatus: expect.objectContaining({ jobId: "job_1", status: "processing" }),
      message: "${EXACT_MESSAGE}",
    });
    await jest.advanceTimersByTimeAsync(2);
    await rejection;
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen).toEqual(["processing", "processing"]);
    expect(invoke).toHaveBeenCalledTimes(2);
  } finally {
    jest.useRealTimers();
  }
});`;

const historicalFixture = String.raw`
test("${TEST_NAME}", async () => {
  const snapshots = [
    {
      applyMode: "draft_auto",
      brandId: "brand_1",
      canCancel: true,
      canCheckAgain: true,
      canRetry: false,
      eventId: "event_1",
      isTerminal: false,
      jobId: "job_1",
      progressKind: "indeterminate",
      progressPercent: 70,
      stageLabel: "Processing browser-safe video...",
      status: "processing",
    },
    {
      applyMode: "draft_auto",
      brandId: "brand_1",
      canCancel: true,
      canCheckAgain: true,
      canRetry: false,
      eventId: "event_1",
      isTerminal: false,
      jobId: "job_1",
      progressKind: "indeterminate",
      progressPercent: 70,
      stageLabel: "Processing browser-safe video...",
      status: "processing",
    },
  ];
  invoke
    .mockResolvedValueOnce({ data: snapshots[0], error: null })
    .mockResolvedValueOnce({ data: snapshots[1], error: null });

  const seen: string[] = [];
  await expect(waitForEventCoverVideoReady("job_1", {
    onStatus: (status) => seen.push(status.status),
    pollIntervalMs: 1,
    timeoutMs: 2,
  })).rejects.toMatchObject({
    code: "processing_timeout",
    lastStatus: expect.objectContaining({
      jobId: "job_1",
      status: "processing",
    }),
    message: "${EXACT_MESSAGE}",
  });
  expect(seen.length).toBeGreaterThanOrEqual(1);
  expect(seen[0]).toBe("processing");
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
      name: "fake clock without async advancement",
      source: canonicalFixture.replace("await jest.advanceTimersByTimeAsync(2);", ""),
      shouldPass: false,
    },
    {
      name: "cleanup outside finally",
      source: canonicalFixture.replace("  } finally {\n    jest.useRealTimers();\n  }", "  }\n  jest.useRealTimers();"),
      shouldPass: false,
    },
    {
      name: "widened timeout",
      source: canonicalFixture.replace("timeoutMs: 2", "timeoutMs: 20"),
      shouldPass: false,
    },
    {
      name: "one-shot replies with superficial comment tokens",
      source: historicalFixture.replace(
        `test("${TEST_NAME}", async () => {`,
        `test("${TEST_NAME}", async () => {\n  // jest.useFakeTimers({ now: 0 }); await jest.advanceTimersByTimeAsync(2); finally { jest.useRealTimers(); } invoke.mockResolvedValue({}); expect(invoke).toHaveBeenCalledTimes(2);`,
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
      source: canonicalFixture.replace("    expect(invoke).toHaveBeenCalledTimes(2);\n", ""),
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
  console.log(`PASS #1664 contract self-test (${cases.length} fixtures)`);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const source = fs.readFileSync(testPath, "utf8");
  const errors = inspectContract(source);
  if (errors.length > 0) {
    console.error("FAIL #1664 event-cover timeout determinism contract:");
    for (const error of errors) console.error(`- ${error}`);
    process.exit(1);
  }
  console.log("PASS #1664 event-cover timeout determinism contract");
}
