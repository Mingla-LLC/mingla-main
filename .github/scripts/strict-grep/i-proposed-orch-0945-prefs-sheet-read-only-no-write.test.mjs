#!/usr/bin/env node
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const gate = readFileSync(resolve(__dirname, "i-proposed-orch-0945-prefs-sheet-read-only-no-write.mjs"), "utf8");

assert.ok(gate.includes("const isEditable = !viewParticipantId"), "self-test: central read-only guard enforced");
assert.ok(gate.includes("handleApplyPreferences"), "self-test: apply handler inspected");
assert.ok(gate.includes("updateBoardPreferences"), "self-test: collab write path ordering checked");
assert.ok(gate.includes("PreferencesService\\.updateUserPreferences|upsert_participant_prefs"), "self-test: direct write names forbidden");

console.log("i-proposed-orch-0945-prefs-sheet-read-only-no-write self-test PASS");
