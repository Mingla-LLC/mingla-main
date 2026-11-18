/* #4453 tester: a server component must never CALL a function exported from a "use client" module.
 * In a production build the RSC bundler replaces client exports with references, so the call throws
 * ("Attempted to call X() from the server") and the page 500s. jsdom render tests cannot see this. */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
const SRC = path.resolve(__dirname, "..");
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [path.join(dir, e.name)] : []);
const isClient = (file: string) => /^\s*["']use client["']/.test(fs.readFileSync(file, "utf8"));
const resolve = (from: string, spec: string) => { const base = path.resolve(path.dirname(from), spec); return [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")].find((f) => fs.existsSync(f) && fs.statSync(f).isFile()); };
describe("#4453 server components never call client functions", () => {
  it("no server module calls a value imported from a 'use client' module", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (isClient(file)) continue;
      const src = fs.readFileSync(file, "utf8");
      for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)) {
        const target = resolve(file, m[2]!);
        if (!target || !isClient(target)) continue;
        const names = m[1]!.split(",").map((s) => s.trim()).filter((s) => s && !s.startsWith("type ")).map((s) => s.split(/\s+as\s+/).pop()!.trim());
        for (const name of names) if (!/^[A-Z]/.test(name) && new RegExp(`(?<![.\\w])${name}\\s*\\(`).test(src.replace(m[0], ""))) offenders.push(`${path.relative(SRC, file)} calls ${name}() from ${path.relative(SRC, target)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
