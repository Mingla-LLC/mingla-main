// T-WL-12 — ORCH-0948 confirm-exclusion strict-grep self-test.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
  new URL("../orch-0948-waitlist-feature.mjs", import.meta.url),
);

function withFakeGit(diffOutput, callback) {
  const root = mkdtempSync(join(tmpdir(), "orch-0948-fake-git-"));
  try {
    const fakeGit = join(root, "git");
    writeFileSync(fakeGit, `#!/usr/bin/env bash\nprintf '%s\\n' "${diffOutput}"\n`);
    chmodSync(fakeGit, 0o755);
    return callback({
      ...process.env,
      PATH: `${root}:${process.env.PATH ?? ""}`,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("T-WL-12: strict-grep gate passes when the diff avoids confirm-owned files", () => {
  withFakeGit("mingla-business/src/components/waitlist/JoinWaitlistSheet.tsx", (env) => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /PASS/);
  });
});

test("T-WL-12: strict-grep gate fails when a checkout confirm route is touched", () => {
  withFakeGit("mingla-business/app/checkout/[eventId]/confirm/page.tsx", (env) => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /I-WAITLIST-CONFIRM-EXCLUSION/);
    assert.match(result.stderr, /checkout\/\[eventId\]\/confirm/);
  });
});

test("T-WL-12: strict-grep gate fails when TicketQrCarousel is touched", () => {
  withFakeGit("mingla-business/src/components/checkout/TicketQrCarousel.tsx", (env) => {
    const result = spawnSync(process.execPath, [SCRIPT], {
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /TicketQrCarousel\.tsx/);
  });
});
