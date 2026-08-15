/**
 * Independent #2058 follow-up guard.
 *
 * GitHub identity resolution is outside the repository REST root. A provider
 * rejection must still use the helper's classified, secret-safe failure path
 * and must occur before the Git Database commit write.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { HandoffError, makeRestAdapter } from "../bundle-baseline-pr-handoff.mjs";

const ACTOR = "mingla-bundle-baseline[bot]";
const SHA = "a".repeat(40);

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => JSON.stringify(payload),
  };
}

test("a rejected public Bot lookup fails closed with a classified diagnostic before commit write", async () => {
  const calls = [];
  const api = makeRestAdapter({
    token: "installation-token-for-tests-only",
    owner: "Mingla-LLC",
    repo: "mingla-main",
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method });
      if (url.includes("/users/")) {
        return response(404, { message: "Not Found" });
      }
      return response(201, { sha: "b".repeat(40) });
    },
  });

  let rejection;
  try {
    await api.createCommit({
      message: "Measured baseline",
      treeSha: "c".repeat(40),
      parentSha: SHA,
      actor: ACTOR,
    });
  } catch (error) {
    rejection = error;
  }

  assert.ok(rejection instanceof HandoffError);
  assert.equal(rejection.code, "REST_FAILURE");
  assert.match(rejection.message, /^GET https:\/\/api\.github\.com\/users\//);
  assert.doesNotMatch(rejection.message, /installation-token-for-tests-only/);

  assert.deepEqual(calls.map(({ method }) => method), ["GET"]);
});
