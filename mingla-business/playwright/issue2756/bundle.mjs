import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const business = path.resolve(here, "../..");
const outputDir = path.join(business, "node_modules/.cache/issue2756");
mkdirSync(outputDir, { recursive: true });
const expoVideoStub = path.join(outputDir, "expo-video-stub.js");
writeFileSync(
  expoVideoStub,
  'exports.__esModule=true;const {View}=require("react-native");exports.VideoView=View;exports.BlurView=View;exports.LinearGradient=View;exports.useVideoPlayer=()=>({play(){},pause(){},muted:true,loop:false});exports.impactAsync=async()=>{};exports.default={expoConfig:{extra:{}}};',
);
const Metro = require(path.join(business, "node_modules", "metro"));
const config = await Metro.loadConfig({ cwd: business });
const dependencyRoot = realpathSync(path.join(business, "node_modules"));
config.resolver.nodeModulesPaths = [
  dependencyRoot,
  ...(config.resolver.nodeModulesPaths ?? []),
];
config.watchFolders = [...(config.watchFolders ?? []), dependencyRoot];
config.resolver.platforms = [...(config.resolver.platforms ?? []), "web"];
const previous = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    platform === "web" &&
    ["expo-video", "expo-blur", "expo-linear-gradient", "expo-haptics", "expo-constants"].includes(moduleName)
  ) {
    return { filePath: expoVideoStub, type: "sourceFile" };
  }
  if (
    moduleName === "@mingla/card-identity" ||
    moduleName.startsWith("@mingla/card-identity/")
  ) {
    const suffix = moduleName.slice("@mingla/card-identity".length);
    return context.resolveRequest(
      context,
      path.join(business, "../packages/card-identity", suffix),
      platform,
    );
  }
  if (
    platform === "web" &&
    (moduleName === "react-native" || moduleName.startsWith("react-native/"))
  ) {
    const suffix = moduleName === "react-native"
      ? ""
      : moduleName.slice("react-native".length);
    return context.resolveRequest(context, `react-native-web${suffix}`, platform);
  }
  return (previous ?? context.resolveRequest)(context, moduleName, platform);
};
await Metro.runBuild(config, {
  entry: path.join(here, "__fixtures__/public-venue-refresh-focus.tsx"),
  platform: "web",
  minify: false,
  dev: true,
  out: path.join(outputDir, "bundle.js"),
  sourceMap: false,
});
writeFileSync(
  path.join(outputDir, "index.html"),
  '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script src="./bundle.js"></script></body></html>',
);
