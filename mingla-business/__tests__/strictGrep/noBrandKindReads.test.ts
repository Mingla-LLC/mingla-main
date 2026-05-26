import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// META-ORCH-0972 Sub-D SC-D-8
// fails-on-revert verified at a1c1d7f70

const SCRIPT = resolve(
  process.cwd(),
  "..",
  ".github",
  "scripts",
  "strict-grep",
  "meta-orch-0972-no-brand-kind-reads.mjs",
);

function writeFixture(root: string, relPath: string, source: string) {
  const file = join(root, relPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}

describe("META-ORCH-0972 no brand.kind reads strict-grep gate", () => {
  test("SC-D-8 fails when active product code reads brand.kind", () => {
    const root = mkdtempSync(join(tmpdir(), "meta-orch-0972-kind-read-"));
    try {
      writeFixture(
        root,
        "mingla-business/src/BadFixture.ts",
        "export const tab = brand.kind === 'trip_planner' ? 'trips' : 'events';\n",
      );

      const result = spawnSync(process.execPath, [SCRIPT, "--root", root], {
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("N1");
      expect(result.stderr).toContain("mingla-business/src/BadFixture.ts");
      expect(result.stderr).toContain("brand.kind");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
