/**
 * Issue #2058 follow-up regression: GitHub's Git Database API defaults an
 * omitted committer to web-flow. The generated commit must explicitly bind
 * both identities to the repository App bot or provenance rejects its own PR.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { makeRestAdapter, HandoffError } from "../bundle-baseline-pr-handoff.mjs";

const ACTOR = "mingla-bundle-baseline[bot]";
const BOT_ID = 317123173;
const SHA = "a".repeat(40);

function response(status, payload) {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => payload === null ? "" : JSON.stringify(payload),
  };
}

test("Git Database commit explicitly binds author and committer to the verified App bot", async () => {
  const calls = [];
  const api = makeRestAdapter({
    token: "installation-token-for-tests-only",
    owner: "Mingla-LLC",
    repo: "mingla-main",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url.endsWith(`/users/${encodeURIComponent(ACTOR)}`)) {
        return response(200, { login: ACTOR, id: BOT_ID, type: "Bot" });
      }
      if (url.endsWith("/repos/Mingla-LLC/mingla-main/git/commits")) {
        return response(201, { sha: "b".repeat(40) });
      }
      throw new Error(`Unexpected request: ${init.method} ${url}`);
    },
  });

  await api.createCommit({
    message: "Measured baseline",
    treeSha: "c".repeat(40),
    parentSha: SHA,
    actor: ACTOR,
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.method, "GET");
  const body = JSON.parse(calls[1].init.body);
  const identity = {
    name: ACTOR,
    email: `${BOT_ID}+${ACTOR}@users.noreply.github.com`,
  };
  assert.deepEqual(body.author, identity);
  assert.deepEqual(body.committer, identity);
  assert.deepEqual(body.parents, [SHA]);
});

test("an unresolved or non-Bot actor fails before the commit write", async () => {
  let commitWrites = 0;
  const api = makeRestAdapter({
    token: "installation-token-for-tests-only",
    owner: "Mingla-LLC",
    repo: "mingla-main",
    fetchImpl: async (url) => {
      if (url.includes("/users/")) return response(200, { login: ACTOR, id: BOT_ID, type: "User" });
      commitWrites += 1;
      return response(201, { sha: "b".repeat(40) });
    },
  });

  await assert.rejects(
    () => api.createCommit({
      message: "Measured baseline",
      treeSha: "c".repeat(40),
      parentSha: SHA,
      actor: ACTOR,
    }),
    (error) => error instanceof HandoffError && error.code === "INVALID_CREDENTIAL_CONFIG",
  );
  assert.equal(commitWrites, 0);
});
