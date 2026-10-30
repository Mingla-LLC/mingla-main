import assert from "node:assert/strict";
import test from "node:test";

import {
  SitesOpsError,
  getObject,
  safeCliFailureLine,
  sha256Bytes,
} from "../lib/sites-ops.mjs";

const CONFIG = {
  endpoint: "https://aaaaaaaaaaaaaaaaaaaa.storage.supabase.co/storage/v1/s3",
  region: "us-east-2",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
};
const BUCKET = "sites-media-approved";
const KEY =
  "approved/123e4567-e89b-42d3-a456-426614174000/" +
  "123e4567-e89b-42d3-a456-426614174001/" +
  `${"a".repeat(64)}/master.webp`;

function noWait(delays) {
  return async (milliseconds) => {
    delays.push(milliseconds);
  };
}

test("#2830 S3 object reads retry bounded transient HTTP failures", async () => {
  const statuses = [503, 429, 200];
  const delays = [];
  let calls = 0;

  const bytes = await getObject(
    CONFIG,
    BUCKET,
    KEY,
    async () => {
      const status = statuses[calls];
      calls += 1;
      return new Response(status === 200 ? "restored" : "unavailable", { status });
    },
    { sleep: noWait(delays) },
  );

  assert.equal(bytes.toString("utf8"), "restored");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 1000]);
});

test("#2830 S3 object reads retry a fetch transport error", async () => {
  const delays = [];
  let calls = 0;

  const bytes = await getObject(
    CONFIG,
    BUCKET,
    KEY,
    async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return new Response("restored", { status: 200 });
    },
    { sleep: noWait(delays) },
  );

  assert.equal(bytes.toString("utf8"), "restored");
  assert.equal(calls, 2);
  assert.deepEqual(delays, [250]);
});

test("#2830 permanent object failures stop immediately with safe identity", async () => {
  const delays = [];
  let calls = 0;

  await assert.rejects(
    getObject(
      CONFIG,
      BUCKET,
      KEY,
      async () => {
        calls += 1;
        return new Response("missing", { status: 404 });
      },
      { sleep: noWait(delays) },
    ),
    (error) => {
      assert.ok(error instanceof SitesOpsError);
      assert.equal(error.code, "S3_OBJECT_READ_FAILED");
      assert.deepEqual(error.details, {
        attempts: 1,
        bucket: BUCKET,
        key: KEY,
        key_sha256: sha256Bytes(Buffer.from(KEY, "utf8")),
        status: "404",
      });
      return true;
    },
  );

  assert.equal(calls, 1);
  assert.deepEqual(delays, []);
});

test("#2830 exhausted retries report the final status and attempt count", async () => {
  const delays = [];
  let calls = 0;

  await assert.rejects(
    getObject(
      CONFIG,
      BUCKET,
      KEY,
      async () => {
        calls += 1;
        return new Response("unavailable", { status: 503 });
      },
      { sleep: noWait(delays) },
    ),
    (error) => {
      assert.ok(error instanceof SitesOpsError);
      assert.equal(error.code, "S3_OBJECT_READ_FAILED");
      assert.equal(error.details.status, "503");
      assert.equal(error.details.attempts, 3);
      return true;
    },
  );

  assert.equal(calls, 3);
  assert.deepEqual(delays, [250, 1000]);
});

test("#2830 CLI diagnostics identify the object without accepting log injection", () => {
  const safe = new SitesOpsError("S3_OBJECT_READ_FAILED", {
    attempts: 3,
    bucket: BUCKET,
    key: KEY,
    key_sha256: sha256Bytes(Buffer.from(KEY, "utf8")),
    status: "503",
  });
  assert.equal(
    safeCliFailureLine(safe),
    `SITES_OPS_ERROR code=S3_OBJECT_READ_FAILED attempts=3 bucket=${BUCKET} ` +
      `key=${KEY} key_sha256=${sha256Bytes(Buffer.from(KEY, "utf8"))} status=503\n`,
  );

  const unsafe = new SitesOpsError("S3_OBJECT_READ_FAILED", {
    attempts: 3,
    bucket: `${BUCKET}\nEXPOSE_SECRET=yes`,
    key: `${KEY}\nEXPOSE_SECRET=yes`,
    key_sha256: "not-a-digest",
    status: "503\nEXPOSE_SECRET=yes",
  });
  assert.equal(
    safeCliFailureLine(unsafe),
    "SITES_OPS_ERROR code=S3_OBJECT_READ_FAILED attempts=3\n",
  );
});
