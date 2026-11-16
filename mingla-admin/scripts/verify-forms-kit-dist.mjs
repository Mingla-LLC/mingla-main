// #4452 (B5) — the build fails when the forms kit did not reach dist/.
//
// The form builder's live preview and "Try it as a visitor" load
// /forms-kit/forms-kit.js and forms-kit.css (lib/formsPreview.js). The Vercel
// buildCommand once ran `vite build` without the kit step, so production
// served a 404 and both previews were blank with nothing failing. This runs
// after `vite build` (vercel.json buildCommand and the npm postbuild hook) and
// exits 1 when either file is missing or empty.
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ADMIN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** The missing or empty kit files under `distDir` (relative names). */
export function missingKitFiles(distDir) {
  return ["forms-kit/forms-kit.js", "forms-kit/forms-kit.css"].filter((rel) => {
    const file = path.join(distDir, rel);
    try {
      return !fs.statSync(file).isFile() || fs.statSync(file).size === 0;
    } catch {
      return true;
    }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = path.resolve(process.argv[2] || path.join(ADMIN, "dist"));
  const missing = missingKitFiles(dist);
  if (missing.length) {
    console.error(`FATAL [forms-kit] missing from ${path.relative(ADMIN, dist) || dist}: ${missing.join(", ")}. Run scripts/build-forms-kit.mjs before vite build.`);
    process.exit(1);
  }
  console.log("[forms-kit] dist/forms-kit/forms-kit.js and forms-kit.css are present");
}
