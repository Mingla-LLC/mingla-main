// #4453: Vercel builds mingla-site-cms with this folder as the root, so nothing
// outside it is uploaded. `next build` type-checks every file tsconfig includes;
// a file there that imports from outside this folder (e.g. ../../../supabase/…)
// fails the production build with TS2307, as the #4488 deploy did. Such a file
// (a cross-surface parity test) must be listed in tsconfig "exclude".
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(__dirname, "../..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

function escapingImports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const specs = [...text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]);
  return specs.filter((spec) => relative(root, resolve(dirname(file), spec)).startsWith(".."));
}

describe("#4453 Studio production build sees only its own folder", () => {
  it("every src file that imports from outside mingla-site-cms is excluded from the build type-check", () => {
    const tsconfig = JSON.parse(readFileSync(join(root, "tsconfig.json"), "utf8")) as { exclude?: string[] };
    const excluded = new Set(tsconfig.exclude ?? []);
    const offenders = walk(join(root, "src"))
      .filter((file) => escapingImports(file).length > 0)
      .map((file) => relative(root, file))
      .filter((file) => !excluded.has(file));
    expect(offenders).toEqual([]);
  });

  it("the scan does see the known cross-surface parity test", () => {
    const file = join(root, "src/lib/planPreview.issue4453.tester.test.ts");
    expect(escapingImports(file)).toContain("../../../supabase/functions/brand-site-control/designPass.ts");
  });
});
