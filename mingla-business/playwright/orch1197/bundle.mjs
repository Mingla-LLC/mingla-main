// ORCH-1197 — bundle the SheetWeb reproduction harness with Metro for web.
//
// The worktree path carries `[ ]` brackets that break metro haste-name
// resolution, so we copy the bracket-free entry into the anchor project and
// bundle from there. The entry imports the WORKTREE-edited SheetMobile via the
// alias `__ORCH1197_SHEET__` -> absolute worktree path, so the measured panel
// geometry reflects the worktree fix. Native-only modules in SheetMobile's import
// graph (gesture-handler, reanimated, safe-area-context, keyboard-controller) are
// aliased to the SAME stubs / committed web shims the deployed web bundle uses,
// so the rendered DOM/CSS matches production. No anchor source is written.
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
const worktreeBusiness = path.resolve(here, "..", "..");
const out = path.join(here, "bundle.js");
const sheetAbs = path.join(worktreeBusiness, "src", "components", "ui", "SheetMobile.tsx");

const anchorBusiness = "/Users/sethogieva/Desktop/mingla-main/mingla-business";

const tmpDir = fs.mkdtempSync(path.join(anchorBusiness, ".orch1197-harness-"));
const tmpEntry = path.join(tmpDir, "entry.tsx");
fs.copyFileSync(path.join(here, "entry.tsx"), tmpEntry);

const Metro = require(path.join(anchorBusiness, "node_modules", "metro"));

process.env.EXPO_PUBLIC_SUPABASE_URL ||= "https://orch1197.supabase.co";
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||= "orch1197-anon-key";

const config = await Metro.loadConfig({ cwd: anchorBusiness });
config.watchFolders = [...(config.watchFolders ?? []), tmpDir, worktreeBusiness];
config.resolver.unstable_enableSymlinks = true;
config.resolver.platforms = [...(config.resolver.platforms ?? []), "web"];
config.resolver.resolverMainFields = ["browser", "module", "main"];

const STUBS = {
  "react-native-safe-area-context": path.join(here, "safe-area-stub.cjs"),
  "react-native-gesture-handler": path.join(here, "gesture-handler-stub.cjs"),
  "react-native-reanimated": path.join(anchorBusiness, "src/shims/reactNativeReanimatedWebStub.js"),
  "react-native-keyboard-controller": path.join(here, "keyboard-controller-stub.cjs"),
};

const prev = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "__ORCH1197_SHEET__") {
    return { filePath: sheetAbs, type: "sourceFile" };
  }
  const stub = STUBS[moduleName];
  if (stub) {
    return { filePath: stub, type: "sourceFile" };
  }
  if (platform === "web" && (moduleName === "react-native" || moduleName.startsWith("react-native/"))) {
    const sub = moduleName === "react-native" ? "" : moduleName.slice("react-native".length);
    return context.resolveRequest(context, "react-native-web" + sub, platform);
  }
  return (prev ?? context.resolveRequest)(context, moduleName, platform);
};

await Metro.runBuild(config, {
  entry: tmpEntry,
  platform: "web",
  minify: false,
  dev: true,
  out,
  sourceMap: false,
});

fs.rmSync(tmpDir, { recursive: true, force: true });
console.log("ORCH-1197 bundle written:", out);
