import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// Folded workflows are intentionally absent from the working tree.  Static
// gates that prove the fold still need the pre-fold source as evidence (for
// example, to verify that every old assertion survived in the batch suite).
// Keep that evidence read-only and recover it from the base branch (or an
// earlier commit when this helper is exercised in a detached fixture); callers
// must never restore the wrapper into .github/workflows in the product tree.
export function readWorkflowSource(root, relative) {
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
  return "";
}

export function copyWorkflowSource(root, relative, destination) {
  const source = readWorkflowSource(root, relative);
  if (!source) throw new Error(`folded workflow source unavailable: ${relative}`);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, source);
}
