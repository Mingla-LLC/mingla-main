// MINGLA-INVARIANT: I-4334-HOST-LAZY-WORKSPACE-SUBPATH | issue #4334 | Every lazy `import("@mingla/<pkg>/<subpath>")` the Host app bundles resolves through Metro to the workspace package on iOS, Android and web (the "In person" address field crashed Host web when location-input was missing).
//
// The dev server sends a lazy package subpath as an app-relative
// "./packages/<pkg>/<subpath>" request. metro.config.js re-roots those at the
// workspace for the packages in WORKSPACE_LAZY_PACKAGES (or pins them exactly);
// anything else 404s against mingla-business/ and the screen crashes.
import fs from "node:fs";
import path from "node:path";

type Resolution = {
  filePath?: string;
  type?: string;
  delegated?: string;
  platform?: string;
};
type MetroConfig = {
  resolver: {
    resolveRequest: (
      context: unknown,
      moduleName: string,
      platform: string,
    ) => Resolution;
  };
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const metro = require("../metro.config.js") as MetroConfig;
const APP = path.resolve(__dirname, "..");
const WORKSPACE = path.resolve(APP, "..");
const context = {
  resolveRequest: (
    _ctx: unknown,
    moduleName: string,
    platform: string,
  ): Resolution => ({ delegated: moduleName, platform }),
};

const reachesWorkspace = (out: Resolution, pkg: string): boolean => {
  const target = out.filePath ?? out.delegated ?? "";
  return target.startsWith(path.join(WORKSPACE, "packages", pkg) + path.sep);
};

const SOURCE_ROOTS = [
  path.join(APP, "src"),
  path.join(APP, "app"),
  path.join(WORKSPACE, "packages"),
];
const SKIP_DIRS = new Set(["node_modules", "__tests__", "dist", "build"]);

const listSources = (dir: string, out: string[] = []): string[] => {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) listSources(path.join(dir, entry.name), out);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
};

// A runtime lazy import of a package subpath. `typeof import(...)` is a type
// and never reaches Metro.
const LAZY_SUBPATH = /(?<!typeof\s)\bimport\(\s*["']@mingla\/([a-z0-9-]+)\/([^"']+)["']\s*\)/g;

const lazySubpathImports = (): { file: string; pkg: string; subpath: string }[] => {
  const found: { file: string; pkg: string; subpath: string }[] = [];
  for (const root of SOURCE_ROOTS) {
    for (const file of listSources(root)) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(LAZY_SUBPATH)) {
        found.push({ file: path.relative(WORKSPACE, file), pkg: m[1], subpath: m[2] });
      }
    }
  }
  return found;
};

describe("issue #4334 Host web address field: lazy location-input chunk", () => {
  it.each(["web", "ios", "android"])(
    "./packages/location-input/src/AddressInput → the workspace file (%s)",
    (platform) => {
      const out = metro.resolver.resolveRequest(
        context,
        "./packages/location-input/src/AddressInput",
        platform,
      );
      expect(out).toEqual({
        delegated: path.join(WORKSPACE, "packages", "location-input", "src", "AddressInput"),
        platform,
      });
    },
  );

  it("the web address field still lazy-loads that exact subpath", () => {
    const web = fs.readFileSync(
      path.join(APP, "src", "components", "location", "sharedAddressField.web.tsx"),
      "utf8",
    );
    expect(web).toContain('import("@mingla/location-input/src/AddressInput")');
  });

  it("every lazy @mingla/<pkg>/<subpath> import the Host app bundles is resolved by Metro", () => {
    const imports = lazySubpathImports();
    // The scan must see the imports it guards, or it proves nothing.
    expect(imports.map((i) => `${i.pkg}/${i.subpath}`)).toEqual(
      expect.arrayContaining([
        "location-input/src/AddressInput",
        "brand-rendering/FollowButton",
        "offering-rendering/DiscountReasonText",
      ]),
    );
    const unresolved = imports
      .filter(({ pkg, subpath }) =>
        ["web", "ios", "android"].some(
          (platform) =>
            !reachesWorkspace(
              metro.resolver.resolveRequest(context, `./packages/${pkg}/${subpath}`, platform),
              pkg,
            ),
        ),
      )
      .map(({ file, pkg, subpath }) => `${file}: @mingla/${pkg}/${subpath}`);
    expect(unresolved).toEqual([]);
  });
});
