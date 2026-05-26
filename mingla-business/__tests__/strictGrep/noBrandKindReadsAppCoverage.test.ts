import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// META-ORCH-0972 Sub-D tester adversarial regression.

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

describe("META-ORCH-0972 no brand.kind reads app/ coverage", () => {
  test("fails when active app route code reads brand.kind", () => {
    const root = mkdtempSync(join(tmpdir(), "meta-orch-0972-app-kind-read-"));
    try {
      writeFixture(
        root,
        "mingla-business/app/(tabs)/hub/BadAppFixture.tsx",
        "export const route = brand.kind === 'physical' ? 'events' : 'trips';\n",
      );

      const result = spawnSync(process.execPath, [SCRIPT, "--root", root], {
        encoding: "utf8",
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain("N1");
      expect(result.stderr).toContain("mingla-business/app/(tabs)/hub/BadAppFixture.tsx");
      expect(result.stderr).toContain("brand.kind");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
