import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  loadProductionAuthority,
  validateAmendment2SourceOwners,
} from "../verify-production-supabase-authority.mjs";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "..", "..", "..");
const CANONICAL_REF = "gqnoajqerqhnvulmnyvv";
const ALTERNATE_REF = "abcdefghijklmnopqrst";

function fakeJwt(ref) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode({ ref })}.signature`;
}

function read(relativePath) {
  return readFileSync(join(REPO_ROOT, relativePath), "utf8");
}

function hostilePath() {
  const root = mkdtempSync(join(tmpdir(), "issue-2016-amendment2-"));
  const bin = join(root, "bin");
  const marker = join(root, "supabase-called");
  mkdirSync(bin, { recursive: true });
  const stub = join(bin, "supabase");
  writeFileSync(stub, `#!/usr/bin/env bash\nprintf called > "${marker}"\n`);
  chmodSync(stub, 0o755);
  return { bin, marker };
}

test("every Amendment 2 source owner agrees with the canonical production authority", () => {
  assert.deepEqual(
    validateAmendment2SourceOwners({
      businessAuthCallback: read("mingla-business/public/auth/callback.html"),
      sentryDeploy: read("scripts/ops/deploy-g3-sentry.sh"),
      discoverDeploy: read("scripts/load/deploy-discover-staging.sh"),
    }),
    [],
  );
});

test("alternate non-denylisted refs fail the callback and both operational source owners", () => {
  const authority = loadProductionAuthority();
  const mutate = (source) => source.replaceAll(CANONICAL_REF, ALTERNATE_REF);
  const callback = mutate(read("mingla-business/public/auth/callback.html")).replace(
    /var SUPABASE_ANON_KEY\s*=\s*\n\s*"[^"]+";/,
    `var SUPABASE_ANON_KEY =\n          "${fakeJwt(ALTERNATE_REF)}";`,
  );
  const failures = validateAmendment2SourceOwners(
    {
      businessAuthCallback: callback,
      sentryDeploy: mutate(read("scripts/ops/deploy-g3-sentry.sh")),
      discoverDeploy: mutate(read("scripts/load/deploy-discover-staging.sh")),
    },
    authority,
  );
  assert.ok(failures.some((failure) => failure.startsWith("business-auth-callback:")));
  assert.ok(failures.some((failure) => failure.startsWith("deploy-g3-sentry:")));
  assert.ok(failures.some((failure) => failure.startsWith("deploy-discover-production:")));
  assert.equal(failures.some((failure) => failure.includes("eyJ")), false);
});

test("callback URL, public JWT ref, and storage-key ref each fail independently", () => {
  const original = read("mingla-business/public/auth/callback.html");
  const mutations = [
    original.replace(
      `https://${CANONICAL_REF}.supabase.co`,
      `https://${ALTERNATE_REF}.supabase.co`,
    ),
    original.replace(
      /var SUPABASE_ANON_KEY\s*=\s*\n\s*"[^"]+";/,
      `var SUPABASE_ANON_KEY =\n          "${fakeJwt(ALTERNATE_REF)}";`,
    ),
    original.replace(
      `sb-${CANONICAL_REF}-auth-token`,
      `sb-${ALTERNATE_REF}-auth-token`,
    ),
  ];
  for (const businessAuthCallback of mutations) {
    const failures = validateAmendment2SourceOwners({
      businessAuthCallback,
      sentryDeploy: read("scripts/ops/deploy-g3-sentry.sh"),
      discoverDeploy: read("scripts/load/deploy-discover-staging.sh"),
    });
    assert.ok(failures.some((failure) => failure.startsWith("business-auth-callback:")));
    assert.equal(failures.some((failure) => failure.includes("eyJ")), false);
  }
});

test("the authority workflow owns every Amendment 2 source and instruction path", () => {
  const workflow = read(".github/workflows/production-supabase-authority.yml");
  for (const path of [
    "scripts/ops/deploy-g3-sentry.sh",
    "scripts/load/deploy-discover-staging.sh",
    "mingla-business/public/auth/callback.html",
    "docs/MINGLA_ENGINEERING_HANDBOOK.md",
    "docs/runbooks/B2_GO_LIVE_CHECKLIST.md",
    "docs/runbooks/B2_VERCEL_DEPLOY_RUNBOOK.md",
  ]) {
    assert.match(workflow, new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("active production instructions route through a verified authority lane", () => {
  const handbook = read("docs/MINGLA_ENGINEERING_HANDBOOK.md");
  const checklist = read("docs/runbooks/B2_GO_LIVE_CHECKLIST.md");
  const vercelRunbook = read("docs/runbooks/B2_VERCEL_DEPLOY_RUNBOOK.md");
  assert.doesNotMatch(handbook, /supabase functions deploy <name> --project-ref/);
  assert.match(handbook, /scripts\/deploy-supabase-functions\.sh/);
  assert.doesNotMatch(checklist, /`supabase (?:db push|functions deploy)`/);
  assert.match(checklist, /PRODUCTION_SUPABASE_AUTHORITY\.md/);
  assert.doesNotMatch(vercelRunbook, /supabase functions deploy brand-stripe-onboard/);
  assert.match(vercelRunbook, /verify-production-supabase-authority\.mjs/);
});

test("G3 Sentry rejects an alternate target before link or secret writes", () => {
  const { bin, marker } = hostilePath();
  const result = spawnSync(
    "bash",
    [join(REPO_ROOT, "scripts/ops/deploy-g3-sentry.sh"), ALTERNATE_REF],
    {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        SUPABASE_ACCESS_TOKEN: "must-not-appear",
        SENTRY_DSN: "must-not-appear",
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no action executed/);
  assert.doesNotMatch(result.stderr, /must-not-appear/);
  assert.equal(existsSync(marker), false);
});

test("legacy discover helper rejects an alternate target before link, migration, or deploy", () => {
  const { bin, marker } = hostilePath();
  const result = spawnSync("bash", [join(REPO_ROOT, "scripts/load/deploy-discover-staging.sh")], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      SUPABASE_ACCESS_TOKEN: "must-not-appear",
      SUPABASE_PROJECT_REF: ALTERNATE_REF,
    },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no action executed/);
  assert.doesNotMatch(result.stderr, /must-not-appear/);
  assert.equal(existsSync(marker), false);
});
