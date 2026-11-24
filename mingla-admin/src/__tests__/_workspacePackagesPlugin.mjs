// #4522 / #4523: esbuild plugin for Admin render harnesses. Admin resolves its
// workspace packages through the Vite alias in vite.config.js; a plain esbuild
// bundle in a test has no such alias, so any component that imports
// "@mingla/calendar-web" (the shared Mingla calendar) failed with
// `Could not resolve "@mingla/calendar-web"`. This plugin mirrors that alias:
//   - "@mingla/calendar-web"              -> packages/calendar-web/src/index.ts
//   - "@mingla/calendar-web/calendar.css" -> an empty module (styles are not rendered)
//   - "react" / "react-dom" imported from packages/** -> Admin's own copy, the
//     same job `resolve.dedupe` does in vite.config.js (the package sits outside
//     this app's node_modules and declares react only as a peer).
// One owner: add a new workspace package alias HERE and in vite.config.js.
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_ROOT = path.resolve(HERE, "..", "..");
const PACKAGES = path.resolve(ADMIN_ROOT, "..", "packages");

export const workspacePackagesPlugin = {
  name: "issue-4522-workspace-packages",
  setup(build) {
    build.onResolve({ filter: /^@mingla\/calendar-web\/calendar\.css$/ }, () => ({
      path: "calendar-web-css",
      namespace: "issue-4522-empty",
    }));
    build.onLoad({ filter: /.*/, namespace: "issue-4522-empty" }, () => ({ loader: "js", contents: "" }));
    build.onResolve({ filter: /^@mingla\/calendar-web$/ }, () => ({
      path: path.join(PACKAGES, "calendar-web", "src", "index.ts"),
    }));
    build.onResolve({ filter: /^react(-dom)?(\/.*)?$/ }, async (args) => {
      if (args.pluginData === "issue-4522-redirected") return undefined;
      if (!args.importer || !args.importer.startsWith(PACKAGES + path.sep)) return undefined;
      const r = await build.resolve(args.path, {
        kind: args.kind,
        resolveDir: ADMIN_ROOT,
        pluginData: "issue-4522-redirected",
      });
      return r.errors.length ? { errors: r.errors } : { path: r.path };
    });
  },
};
