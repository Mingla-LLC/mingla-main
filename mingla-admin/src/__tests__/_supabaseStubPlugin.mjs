// #4571: esbuild plugin for Admin render harnesses. Components now reach
// lib/supabase.js through their imports (Work card subtask links, record
// panel). In a bundled plain-Node harness, the real client builds a Realtime
// socket at import time, and Node 20 (the CI admin lane) has no native
// WebSocket, so the harness crashed before any test ran. Render tests never
// call the server, so the module is replaced by an inert stub with the same
// named exports. Any call made through it throws, so a test cannot pass by
// accident against a fake server.
export const supabaseStubPlugin = {
  name: "issue-4571-supabase-stub",
  setup(build) {
    build.onResolve({ filter: /(^|\/)lib\/supabase(\.js)?$/ }, () => ({ path: "supabase-stub", namespace: "issue-4571-stub" }));
    build.onLoad({ filter: /.*/, namespace: "issue-4571-stub" }, () => ({
      loader: "js",
      contents: `
const refuse = (what) => () => { throw new Error("render harness: no server (" + what + ")"); };
export const supabase = new Proxy({}, { get: (_t, key) => refuse(String(key)) });
export default supabase;
export const SUPABASE_URL = "http://localhost:54321";
export const SUPABASE_ANON_KEY = "test-anon-key";
export const invokeWithRefresh = refuse("invokeWithRefresh");
export function isSessionExpiredError() { return false; }
export const SESSION_EXPIRED_MESSAGE = "Your session expired.";
`,
    }));
  },
};
