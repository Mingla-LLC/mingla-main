/**
 * #3720 Wave 4 — GitHub-runner secret-readiness recovery.
 *
 * The production gate stays fail-closed, but an unexpected child-process or
 * orchestration exception must retain a value-blind, actionable stage code.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";

import {
  listLiveSecretNames,
  ReadinessError,
  runFunctionReadinessPreflight,
} from "./preflight-function-secret-readiness.mjs";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");
const projectRef = "gqnoajqerqhnvulmnyvv";

function codeFrom(operation) {
  try {
    operation();
  } catch (error) {
    assert(error instanceof ReadinessError);
    return error.code;
  }
  return null;
}

test("#3720 runner failure before a child result is value-blind and fail-closed", () => {
  const code = codeFrom(() => listLiveSecretNames({
    projectRef,
    spawn: () => {
      throw new Error("must never reach output: credential-shaped metadata");
    },
  }));
  assert.equal(code, "secret_list_spawn_failed");
});

test("#3720 child-process error and CLI refusal remain distinguishable", () => {
  assert.equal(codeFrom(() => listLiveSecretNames({
    projectRef,
    spawn: () => ({ error: new Error("sensitive child detail") }),
  })), "secret_list_spawn_failed");
  assert.equal(codeFrom(() => listLiveSecretNames({
    projectRef,
    spawn: () => ({ status: 1, stdout: "", stderr: "sensitive CLI detail" }),
  })), "secret_list_failed");
});

test("#3720 unexpected evaluation exceptions report only the stage", () => {
  const manifest = JSON.parse(
    readFileSync(resolve(ROOT, "supabase/secrets.manifest.json"), "utf8"),
  );
  const code = codeFrom(() => runFunctionReadinessPreflight({
    projectRef,
    selectedFunctions: ["missing-function"],
    mergedCommit: "a".repeat(40),
    liveNames: manifest.secrets.map((record) => record.name),
    contractPath: resolve(
      ROOT,
      "docs/contracts/production-supabase-authority.json",
    ),
  }));
  assert.equal(code, "readiness_evaluation_failed");
});

test("#3720 workflow exposes read-only preflight and wrapper stops before deploy", () => {
  const workflow = readFileSync(resolve(ROOT, ".github/workflows/deploy-functions.yml"), "utf8");
  const wrapper = readFileSync(resolve(ROOT, "scripts/deploy-supabase-functions.sh"), "utf8");
  assert.match(workflow, /preflight_only:/);
  assert.match(workflow, /MINGLA_PREFLIGHT_ONLY: \$\{\{ inputs\.preflight_only \|\| 'false' \}\}/);
  assert.match(workflow, /preflight_arg="--preflight-only"/);
  assert.match(wrapper, /--preflight-only\)/);
  assert.match(
    wrapper,
    /--preflight-only is supported only by the normal selected-function lane/,
  );
  const readiness = wrapper.indexOf(
    'node "${repo_root}/scripts/secrets/preflight-function-secret-readiness.mjs"',
  );
  const stop = wrapper.indexOf('echo "PASS deploy: preflight-only; no edge mutation executed"');
  const materialize = wrapper.indexOf('--write-config "$config_file"');
  const mutation = wrapper.indexOf('supabase functions deploy "$function_name"');
  assert(readiness > 0 && stop > readiness);
  assert(materialize > stop, "config materialization must follow sealed-policy readiness");
  assert(mutation > materialize);
});
