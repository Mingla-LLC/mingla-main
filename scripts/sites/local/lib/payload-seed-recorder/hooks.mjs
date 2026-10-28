// #2829 W7b — module hooks for reading a brand's existing Payload seed WITHOUT
// running Payload. The brand's seed modules import `payload`, `dotenv/config`
// and their own `payload.config`; those are replaced by inert stubs so the seed
// code runs against an in-memory recorder (see recorder.mjs) and never opens a
// database or a network connection. Extensionless relative imports (TypeScript
// style) are resolved to `.ts` files, which Node then type-strips.
//
// Used only by the local seed (scripts/sites/local/seed-young-and-stamped.mjs),
// in a child process, against a read-only source directory.

import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const STUB_DIR = new URL("./stubs/", import.meta.url);
const STUBS = new Map([
  ["payload", new URL("payload.mjs", STUB_DIR).href],
  ["dotenv/config", new URL("empty.mjs", STUB_DIR).href],
]);

export async function resolve(specifier, context, nextResolve) {
  const stub = STUBS.get(specifier);
  if (stub) return { url: stub, shortCircuit: true };
  if (/(^|\/)payload\.config(\.ts)?$/.test(specifier)) {
    return { url: new URL("empty.mjs", STUB_DIR).href, shortCircuit: true };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    const base = new URL(specifier, context.parentURL);
    const path = fileURLToPath(base);
    if (!/\.[cm]?[jt]s$/.test(path)) {
      for (const candidate of [`${path}.ts`, `${path}/index.ts`]) {
        if (existsSync(candidate)) return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
