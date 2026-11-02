// Issue #4238 wave 2 — shared Vite SSR loader for the Admin render tests.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

export const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function withVite(run) {
  const vite = await createServer({
    root: adminRoot,
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
    logLevel: "silent",
  });
  try {
    return await run(vite);
  } finally {
    await vite.close();
  }
}
