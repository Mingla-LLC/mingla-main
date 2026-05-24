#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");
const source = readFileSync(resolve(repoRoot, "app-mobile/src/components/PreferencesSheet.tsx"), "utf8");

const failures = [];
if (!source.includes("const isEditable = !viewParticipantId")) {
  failures.push("PreferencesSheet missing central `const isEditable = !viewParticipantId` guard");
}
if (!source.includes("viewParticipantId?: string")) {
  failures.push("PreferencesSheet missing viewParticipantId prop");
}

const applyStart = source.indexOf("const handleApplyPreferences = useCallback(async () => {");
const applyEnd = source.indexOf("  }, [", applyStart);
const applyBlock = applyStart >= 0 && applyEnd > applyStart ? source.slice(applyStart, applyEnd) : "";
if (!applyBlock.includes("if (!isEditable) return;")) {
  failures.push("handleApplyPreferences must short-circuit on !isEditable before any write");
}
if (applyBlock.includes("updateBoardPreferences") && applyBlock.indexOf("if (!isEditable) return;") > applyBlock.indexOf("updateBoardPreferences")) {
  failures.push("updateBoardPreferences appears before the read-only guard");
}
if (/PreferencesService\.updateUserPreferences|upsert_participant_prefs/.test(applyBlock)) {
  failures.push("PreferencesSheet read-only gate forbids direct preference RPC/service writes in apply block");
}

if (failures.length > 0) {
  console.error("i-proposed-orch-0945-prefs-sheet-read-only-no-write FAILED:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("i-proposed-orch-0945-prefs-sheet-read-only-no-write PASS");
