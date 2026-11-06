// Issue #4276 S5: the prompt version can't change without the scorer's expected
// version.
//
// MINGLA-INVARIANT: I-4276-PROMPT-VERSION-MATCHES-SCORER | issue #4276 | Every writer of ai_signal_scores stamps the prompt version the scorer expects
//
// computeScore ignores an AI slice whose prompt_version differs from the expected
// one. So bumping PROMPT_VERSION alone quietly drops every newly evaluated place to
// a rules-only score, with nothing failing anywhere. Three writers stamp the version
// and Postgres can't import a constant, so CI compares them.
//
// FAILS-ON-REVERT: change any one of the versions below and this fails. Verified by
// setting PROMPT_VERSION to "v5" in run-place-intelligence-trial/index.ts.

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { DEFAULT_EXPECTED_PROMPT_VERSION } from "../signalScorer.ts";

const FUNCTIONS = new URL("../../", import.meta.url);
const MIGRATIONS = new URL("../../../migrations/", import.meta.url);
const DRIFT_FN = "tg_meta_orch_1009_sub_d_drift_queue_reeval";

function promptVersionIn(relPath: string): string {
  const source = Deno.readTextFileSync(new URL(relPath, FUNCTIONS));
  const match = source.match(/^(?:export )?const PROMPT_VERSION = "([^"]+)";$/m);
  assert(match, `${relPath} no longer declares PROMPT_VERSION where this gate reads it`);
  return match[1];
}

function newestDriftTriggerBody(): { name: string; sql: string } {
  const names = [...Deno.readDirSync(MIGRATIONS)]
    .filter((e) => e.isFile && e.name.endsWith(".sql"))
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const name of names) {
    const sql = Deno.readTextFileSync(new URL(name, MIGRATIONS));
    if (new RegExp(`CREATE\\s+OR\\s+REPLACE\\s+FUNCTION\\s+(public\\.)?${DRIFT_FN}`, "i").test(sql)) {
      return { name, sql };
    }
  }
  throw new Error(`no migration defines ${DRIFT_FN}`);
}

Deno.test("the trial pipeline stamps the version the scorer expects", () => {
  assertEquals(
    promptVersionIn("run-place-intelligence-trial/index.ts"),
    DEFAULT_EXPECTED_PROMPT_VERSION,
    "Bumping the prompt? Set DEFAULT_EXPECTED_PROMPT_VERSION in _shared/signalScorer.ts in " +
      "the same change, and plan the re-evaluation: every older slice then scores rules-only.",
  );
});

Deno.test("the business authoring pipeline stamps the version the scorer expects", () => {
  assertEquals(
    promptVersionIn("run-business-place-authoring-pipeline/index.ts"),
    DEFAULT_EXPECTED_PROMPT_VERSION,
  );
});

Deno.test("the drift trigger labels its runs with the version the scorer expects", () => {
  const { name, sql } = newestDriftTriggerBody();
  const labels = [...sql.matchAll(/'(v\d+)'\s*,\s*'gemini-/g)].map((m) => m[1]);
  assert(labels.length >= 2, `${name}: the drift trigger's version labels were not found`);
  for (const label of labels) {
    assertEquals(label, DEFAULT_EXPECTED_PROMPT_VERSION, `${name} labels drift runs ${label}`);
  }
});
