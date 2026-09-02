/**
 * #3054 regression proof for production source verification.
 *
 * Supabase removes files reached only by TypeScript type imports from its
 * downloadable runtime bundle. The verifier accepts only that compile-time
 * erasure while retaining byte-exact checks for every runtime dependency.
 */

import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import test from "node:test";

import {
  buildImportClosure,
  buildRuntimeImportClosure,
} from "./audit-function-secret-contract.mjs";
import {
  ReconciliationError,
  verifyDownloadedFunctionSources,
} from "./reconcile-governed-secrets.mjs";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..", "..");
const projectRef = "gqnoajqerqhnvulmnyvv";
const functionName = "attendance-claim-backfill";
const entrypoint = resolve(
  ROOT,
  "supabase/functions",
  functionName,
  "index.ts",
);

function simulatedDownload({ mutatePath = null, omitPath = null } = {}) {
  const closure = buildRuntimeImportClosure(entrypoint, ROOT);
  assert.deepEqual(closure.failures, []);
  return (_command, args) => {
    const workdir = args[args.indexOf("--workdir") + 1];
    for (const localPath of closure.files) {
      const repoPath = relative(ROOT, localPath).split("\\").join("/");
      if (repoPath === omitPath) continue;
      const downloaded = resolve(workdir, repoPath);
      mkdirSync(dirname(downloaded), { recursive: true });
      const source = readFileSync(localPath, "utf8");
      writeFileSync(
        downloaded,
        repoPath === mutatePath ? `${source}\n// runtime drift\n` : source,
      );
    }
    return { status: 0, stdout: "", stderr: "" };
  };
}

test("#3054 happy: Supabase type-only erasure keeps runtime source verifiable", () => {
  const complete = buildImportClosure(entrypoint, ROOT);
  const runtime = buildRuntimeImportClosure(entrypoint, ROOT);
  const typePath = "supabase/functions/_shared/email/types.ts";
  assert.ok(
    complete.files.some((path) => relative(ROOT, path) === typePath),
  );
  assert.ok(
    runtime.files.every((path) => relative(ROOT, path) !== typePath),
  );
  assert.equal(
    verifyDownloadedFunctionSources({
      projectRef,
      selectedFunctions: [functionName],
      spawn: simulatedDownload(),
    }),
    true,
  );
});

test("#3054 adversarial: missing or changed runtime source still fails closed", () => {
  const runtimePath = "supabase/functions/_shared/email/shell.ts";
  assert.throws(
    () =>
      verifyDownloadedFunctionSources({
        projectRef,
        selectedFunctions: [functionName],
        spawn: simulatedDownload({ omitPath: runtimePath }),
      }),
    (error) =>
      error instanceof ReconciliationError &&
      error.code === "deployed_source_closure_invalid",
  );
  assert.throws(
    () =>
      verifyDownloadedFunctionSources({
        projectRef,
        selectedFunctions: [functionName],
        spawn: simulatedDownload({ mutatePath: runtimePath }),
      }),
    (error) =>
      error instanceof ReconciliationError &&
      error.code === "deployed_source_mismatch" &&
      error.publicNames.includes(runtimePath),
  );
});

test("#3054 adversarial: a runtime edge overrides a type-only edge", () => {
  const fixture = mkdtempSync(resolve(tmpdir(), "mingla-3054-closure-"));
  try {
    const entry = resolve(fixture, "index.ts");
    writeFileSync(entry, 'import type { Shape } from "./types.ts";\n');
    assert.deepEqual(buildRuntimeImportClosure(entry, fixture), {
      failures: [],
      files: [entry],
    });

    writeFileSync(
      entry,
      'import type { Shape } from "./types.ts";\nimport "./types.ts";\n',
    );
    assert.deepEqual(
      buildRuntimeImportClosure(entry, fixture).failures,
      ["index.ts:relative_import_missing:./types.ts"],
    );
  } finally {
    rmSync(fixture, { force: true, recursive: true });
  }
});
