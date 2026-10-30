import assert from "node:assert/strict";
import test from "node:test";

import { SitesOpsError, getObject } from "../lib/sites-ops.mjs";

const CONFIG = {
  endpoint: "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/s3",
  region: "us-east-2",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
};
const BUCKET = "sites-publication-artifacts";
const KEY =
  "publications/123e4567-e89b-42d3-a456-426614174000/" +
  `123e4567-e89b-42d3-a456-426614174001/${"b".repeat(64)}.json`;

test("#2830 tester: credentials and missing objects are never retried", async () => {
  for (const status of [400, 401, 403, 404]) {
    let calls = 0;
    let bodyReads = 0;
    const sleeps = [];

    await assert.rejects(
      getObject(
        CONFIG,
        BUCKET,
        KEY,
        async () => {
          calls += 1;
          return {
            ok: false,
            status,
            arrayBuffer: async () => {
              bodyReads += 1;
              throw new Error("a provider error body must never be read");
            },
          };
        },
        { sleep: async (delay) => sleeps.push(delay) },
      ),
      (error) => error instanceof SitesOpsError &&
        error.code === "S3_OBJECT_READ_FAILED" &&
        error.details.status === String(status) &&
        error.details.attempts === 1,
    );

    assert.equal(calls, 1, `status ${status}`);
    assert.equal(bodyReads, 0, `status ${status}`);
    assert.deepEqual(sleeps, [], `status ${status}`);
  }
});

test("#2830 tester: every allowlisted transient status gets exactly three attempts", async () => {
  for (const status of [408, 425, 429, 500, 502, 503, 504]) {
    let calls = 0;
    const sleeps = [];

    await assert.rejects(
      getObject(
        CONFIG,
        BUCKET,
        KEY,
        async () => {
          calls += 1;
          return new Response("unavailable", { status });
        },
        { sleep: async (delay) => sleeps.push(delay) },
      ),
      (error) => error instanceof SitesOpsError &&
        error.details.status === String(status) &&
        error.details.attempts === 3,
    );

    assert.equal(calls, 3, `status ${status}`);
    assert.deepEqual(sleeps, [250, 1000], `status ${status}`);
  }
});

test("#2830 tester: a broken success body is retried, then returned intact", async () => {
  let calls = 0;
  const sleeps = [];
  const expected = Buffer.from([0, 1, 2, 255]);

  const result = await getObject(
    CONFIG,
    BUCKET,
    KEY,
    async () => {
      calls += 1;
      if (calls === 1) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => {
            throw new TypeError("terminated");
          },
        };
      }
      return new Response(expected, { status: 200 });
    },
    { sleep: async (delay) => sleeps.push(delay) },
  );

  assert.deepEqual(result, expected);
  assert.equal(calls, 2);
  assert.deepEqual(sleeps, [250]);
});

test("#2830 tester: programmer errors are not relabelled as storage failures", async () => {
  const sentinel = new Error("local implementation defect");
  let calls = 0;

  await assert.rejects(
    getObject(CONFIG, BUCKET, KEY, async () => {
      calls += 1;
      throw sentinel;
    }),
    (error) => error === sentinel,
  );
  assert.equal(calls, 1);
});
