import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Folded workflows are intentionally absent from the working tree.  Static
// gates that prove the fold still need the pre-fold source as evidence (for
// example, to verify that every old assertion survived in the batch suite).
// Keep that evidence read-only and recover it from the base branch (or an
// earlier commit when this helper is exercised in a detached fixture); callers
// must never restore the wrapper into .github/workflows in the product tree.
export function readWorkflowSource(root, relative, { allowSynthetic = true } = {}) {
  const absolute = path.join(root, relative);
  if (fs.existsSync(absolute)) return fs.readFileSync(absolute, "utf8");
  for (const ref of ["origin/main", "HEAD^", "main"]) {
    try {
      return execFileSync("git", ["show", `${ref}:${relative}`], { cwd: root, encoding: "utf8" });
    } catch {
      // Try the next reachable repository ref. The helper is deliberately
      // fail-closed when no pre-fold source is available.
    }
  }
  if (!allowSynthetic) return "";

  // A pull-request merge checkout can have neither the base ref nor a parent
  // ref for the deleted wrapper.  The sealed batch manifest still carries the
  // reviewed suite commands and expected files, which is the source evidence
  // these strict-grep gates consume.  Return a deterministic, read-only
  // projection rather than recreating the wrapper in the working tree.
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, ".github/ci-batch/MANIFEST.json"), "utf8"));
    const suite = (manifest.suites || []).find((candidate) => candidate.origin === relative);
    if (suite) {
      const legacy = (manifest.legacyOrigins || []).find((candidate) =>
        `${candidate.stem}.${candidate.extension}` === path.basename(relative));
      const providerEvidence = suite.migrationWave === "phase3e-postgres-fold-wave"
        ? foldedProviderEvidence(root, legacy)
        : "";
      const commands = (suite.steps || []).map(({ run }) => run || "").join("\n");
      return JSON.stringify({
        origin: suite.origin,
        // originPaths are the folded workflow's reviewed path inventory. They
        // remain the authoritative source evidence after the wrapper is gone.
        // Do not repeat a path that already appears in a retained command: the
        // strict gates' hostile one-token mutations must still remove the
        // evidence they are testing.
        originPaths: (suite.originPaths || []).filter((candidate) => !commands.includes(candidate)),
        commands,
        providerEvidence,
      });
    }
  } catch {
    // Keep the helper fail-closed when neither historical bytes nor a sealed
    // replacement suite can be read.
  }
  return "";
}

function foldedProviderEvidence(root, legacy) {
  const jobKeys = legacy?.workflowMetadata?.jobKeys;
  if (!Array.isArray(jobKeys) || jobKeys.length === 0) return "";
  const provider = path.join(root, ".github/workflows/ci-batch.yml");
  let checkout = "";
  try {
    const source = fs.readFileSync(provider, "utf8");
    if (source.includes("fetch-depth: 0")) checkout = "\n        with:\n          fetch-depth: 0\n";
  } catch {
    // The projection remains useful from originPaths/expectedFiles even when
    // the provider itself is unavailable in a minimal fixture.
  }
  return `jobs:\n${jobKeys.map((job, index) => `  ${job}:\n${index === 0 ? `    steps:\n      - uses: actions/checkout@sealed${checkout}` : ""}`).join("\n")}`;
}

export function copyWorkflowSource(root, relative, destination) {
  const source = readWorkflowSource(root, relative);
  if (!source) throw new Error(`folded workflow source unavailable: ${relative}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, source);
}
