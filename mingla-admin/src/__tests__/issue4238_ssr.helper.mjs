// Issue #4238 wave 2 — shared Vite SSR loader for the Admin render tests.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

export const adminRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const SUPABASE_LIB = path.join(adminRoot, "src", "lib", "supabase.js");
const SUPABASE_STUB_ID = "\0issue4238-ssr-supabase-stub";

// These render tests run in the admin-node20-install CI lane. The real
// `src/lib/supabase.js` builds a Supabase client at import time, and on Node 20
// its realtime client throws "native WebSocket not found". The panels under test
// only render pure props, so the client is swapped for an inert stub that fails
// loudly if a render ever reaches the network.
const SUPABASE_STUB = `
const unavailable = (name) => () => {
  throw new Error("issue4238 SSR render test: supabase." + name + " is not available");
};
const inert = (name) => new Proxy(unavailable(name), {
  get: (_target, key) => (key === "then" ? undefined : inert(name + "." + String(key))),
});
export const supabase = inert("client");
export const SUPABASE_URL = undefined;
export const SUPABASE_ANON_KEY = undefined;
export const invokeWithRefresh = unavailable("invokeWithRefresh");
export function isSessionExpiredError() { return false; }
export const SESSION_EXPIRED_MESSAGE = "Your admin session expired. Sign in again to continue.";
`;

function stubSupabaseClient() {
  return {
    name: "issue4238-ssr-supabase-stub",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (!importer || !/lib\/supabase(\.js)?$/.test(source)) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved && path.normalize(resolved.id) === SUPABASE_LIB ? SUPABASE_STUB_ID : null;
    },
    load(id) {
      return id === SUPABASE_STUB_ID ? SUPABASE_STUB : null;
    },
  };
}

export async function withVite(run) {
  const vite = await createServer({
    root: adminRoot,
    appType: "custom",
    server: { middlewareMode: true, hmr: false },
    logLevel: "silent",
    plugins: [stubSupabaseClient()],
  });
  try {
    return await run(vite);
  } finally {
    await vite.close();
  }
}
