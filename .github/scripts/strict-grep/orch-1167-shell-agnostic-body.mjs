#!/usr/bin/env node
/**
 * ORCH-1167 [event-page-canonical] — I-PROPOSED-1167-SHELL-AGNOSTIC-BODY.
 *
 * The shared `EventOfferingBody` (packages/offering-rendering/EventOfferingBody.tsx)
 * MUST be a PURE CONTENT body: it declares NO scroll container as its root and NO
 * cover host. Each surface injects its own scroll + parallax scaffold around it
 * (web/business = ParallaxCoverShell + RN ScrollView; consumer = gorhom
 * BottomSheetScrollView). If the body grew a scroll root it would re-trigger the
 * gorhom freeze on the consumer sheet (ORCH-1016/1043/1138).
 *
 * Fails if EventOfferingBody.tsx:
 *   (a) imports/renders ScrollView / BottomSheetScrollView / FlatList / SectionList
 *       / VirtualizedList (a scroll container), OR
 *   (b) imports ParallaxCoverShell (the body must NOT wrap the cover shell).
 *
 * Self-test (`--self-test`): a synthetic body WITH a ScrollView trips the gate; the
 * real file passes.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd().endsWith("mingla-business")
  ? join(process.cwd(), "..")
  : process.cwd();

const BODY = "packages/offering-rendering/EventOfferingBody.tsx";

const stripComments = (src) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

function check(src, label) {
  const failures = [];
  const code = stripComments(src);
  // (a) no scroll container rendered/imported in the body.
  for (const sym of [
    "ScrollView",
    "BottomSheetScrollView",
    "FlatList",
    "SectionList",
    "VirtualizedList",
  ]) {
    const re = new RegExp(`\\b${sym}\\b`);
    if (re.test(code)) {
      failures.push(
        `${label}: references <${sym}> — the shell-agnostic body must host NO ` +
          "scroll root. Each surface injects its scroll host AROUND the body.",
      );
    }
  }
  // (b) the body must not wrap the parallax cover shell.
  if (/ParallaxCoverShell/.test(code)) {
    failures.push(
      `${label}: imports/renders ParallaxCoverShell — the body must be a pure ` +
        "content body; the cover shell is composed by the surface wrapper.",
    );
  }
  return failures;
}

function runSelfTest() {
  const bad = `
    import { ScrollView, View } from "react-native";
    export const EventOfferingBody = () => (<ScrollView><View/></ScrollView>);
  `;
  const good = `
    import { View, Text, Pressable } from "react-native";
    export const EventOfferingBody = () => (<View><Text>ok</Text></View>);
  `;
  const badFails = check(bad, "synthetic-bad").length > 0;
  const goodPasses = check(good, "synthetic-good").length === 0;
  if (!badFails) {
    console.error("SELF-TEST FAIL: scroll-root body did not trip the gate.");
    process.exit(1);
  }
  if (!goodPasses) {
    console.error("SELF-TEST FAIL: clean body wrongly tripped the gate.");
    process.exit(1);
  }
  console.log("ORCH-1167 shell-agnostic-body gate SELF-TEST PASS.");
  process.exit(0);
}

if (process.argv.includes("--self-test")) {
  runSelfTest();
} else {
  const path = join(root, BODY);
  if (!existsSync(path)) {
    console.error(`ORCH-1167 shell-agnostic-body gate FAILED: ${BODY} missing.`);
    process.exit(1);
  }
  const failures = check(readFileSync(path, "utf8"), BODY);
  if (failures.length > 0) {
    console.error("\nORCH-1167 shell-agnostic-body gate FAILED:\n");
    for (const f of failures) console.error(`  ✗ ${f}`);
    process.exit(1);
  }
  console.log("ORCH-1167 shell-agnostic-body gate PASS.");
}
