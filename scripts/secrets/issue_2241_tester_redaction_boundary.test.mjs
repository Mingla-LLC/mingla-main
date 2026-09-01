/**
 * #2241 independent tester proof: the live CLI boundary is value-blind on
 * success and failure, not only after a caller has already reduced valid JSON.
 */

import assert from "node:assert/strict";
import test from "node:test";

import {
  listLiveSecretNames,
  ReadinessError,
} from "./preflight-function-secret-readiness.mjs";

const projectRef = "gqnoajqerqhnvulmnyvv";
const canary = "SYNTHETIC_SECRET_VALUE_MUST_NEVER_ESCAPE_2241";

test("#2241 tester adversarial: failed secret-list subprocess cannot leak captured output", () => {
  let thrown = null;
  try {
    listLiveSecretNames({
      projectRef,
      spawn(command, args, options) {
        assert.equal(command, "supabase");
        assert.deepEqual(args, [
          "secrets",
          "list",
          "--project-ref",
          projectRef,
          "--output",
          "json",
        ]);
        assert.equal(options.encoding, "utf8");
        return {
          status: 1,
          stdout: JSON.stringify([{ name: "SAFE_NAME", value: canary }]),
          stderr: `provider diagnostic accidentally contained ${canary}`,
        };
      },
    });
  } catch (error) {
    thrown = error;
  }

  assert(thrown instanceof ReadinessError);
  assert.equal(thrown.code, "secret_list_failed");
  assert.deepEqual(thrown.details, []);
  assert(!String(thrown).includes(canary));
  assert(!JSON.stringify(thrown).includes(canary));
});

test("#2241 tester adversarial: successful secret-list subprocess returns names only", () => {
  const names = listLiveSecretNames({
    projectRef,
    spawn: () => ({
      status: 0,
      stdout: JSON.stringify({
        secrets: [
          { name: "SECOND_SAFE_NAME", value: canary, digest: canary },
          { name: "FIRST_SAFE_NAME", value: canary, updated_at: canary },
        ],
      }),
      stderr: canary,
    }),
  });

  assert.deepEqual(names, ["FIRST_SAFE_NAME", "SECOND_SAFE_NAME"]);
  assert(!JSON.stringify(names).includes(canary));
});
