import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const business = path.resolve(here, "../..");
const outputDir = path.join(business, "node_modules/.cache/issue2399");
mkdirSync(outputDir, { recursive: true });
const Metro = require(path.join(business, "node_modules", "metro"));
const config = await Metro.loadConfig({ cwd: business });
config.resolver.platforms = [...(config.resolver.platforms ?? []), "web"];
config.resolver.resolverMainFields = ["browser", "module", "main"];
const previous = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "react-native-safe-area-context") {
    return context.resolveRequest(
      context,
      path.join(here, "safeAreaContextShim.ts"),
      platform,
    );
  }
  if (platform === "web" && (moduleName === "react-native" || moduleName.startsWith("react-native/"))) {
    const suffix = moduleName === "react-native" ? "" : moduleName.slice("react-native".length);
    return context.resolveRequest(context, `react-native-web${suffix}`, platform);
  }
  return (previous ?? context.resolveRequest)(context, moduleName, platform);
};
await Metro.runBuild(config, {
  entry: path.join(here, "entry.tsx"), platform: "web", minify: false, dev: true,
  out: path.join(outputDir, "bundle.js"), sourceMap: false,
});
writeFileSync(
  path.join(outputDir, "index.html"),
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="./bundle.js"></script></body></html>',
);
