import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const business = path.resolve(here, "../..");
const outputDir = path.join(business, "node_modules/.cache/issue2769");
const outputBundle = path.join(outputDir, "bundle.js");
const modules = realpathSync(path.join(business, "node_modules"));
const expoVideoStub = path.join(outputDir, "expo-video-stub.js");
const nativeLeafStub = path.join(outputDir, "native-leaf-stub.js");
const expoConstantsStub = path.join(outputDir, "expo-constants-stub.js");
mkdirSync(outputDir, { recursive: true });
writeFileSync(expoVideoStub, `const React=require(${JSON.stringify(path.join(modules,"react"))});exports.VideoView=React.forwardRef((p,r)=>React.createElement("div",{ref:r},p&&p.children));exports.useVideoPlayer=()=>({play(){},pause(){},loop:false,muted:true});\n`);
writeFileSync(expoConstantsStub, `module.exports={__esModule:true,default:{expoConfig:{extra:{}}}};\n`);
writeFileSync(nativeLeafStub, `const React=require(${JSON.stringify(path.join(modules,"react"))});const Box=React.forwardRef((p,r)=>React.createElement("div",{ref:r},p&&p.children));module.exports=new Proxy({__esModule:true,default:Box,BlurView:Box,LinearGradient:Box,impactAsync:async()=>undefined,notificationAsync:async()=>undefined,selectionAsync:async()=>undefined,ImpactFeedbackStyle:{},NotificationFeedbackType:{}},{get:(v,k)=>k in v?v[k]:Box});\n`);

const Metro = require(path.join(business, "node_modules", "metro"));
const config = await Metro.loadConfig({ cwd: business });
config.resolver.platforms = [...(config.resolver.platforms ?? []), "web"];
config.resolver.resolverMainFields = ["browser", "module", "main"];
config.watchFolders = [...(config.watchFolders ?? []), modules];
config.resolver.nodeModulesPaths = [modules, ...(config.resolver.nodeModulesPaths ?? [])];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules ?? {}),
  react: path.join(modules, "react"),
  "react-dom": path.join(modules, "react-dom"),
  "react-native": path.join(modules, "react-native"),
  "@mingla/card-identity": path.resolve(business, "../packages/card-identity"),
  "issue2769-real-public-venue": path.resolve(business, "../packages/brand-rendering/PublicVenueScreen.tsx"),
  "issue2769-real-consent-banner": path.resolve(business, "src/analytics/ConsentBanner.web.tsx"),
  "issue2769-real-consent-hook": path.resolve(business, "src/analytics/useWebConsentState.web.ts"),
};
const previousResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === "web" && moduleName === "expo-video") return { filePath: expoVideoStub, type: "sourceFile" };
  if (platform === "web" && moduleName === "expo-constants") return { filePath: expoConstantsStub, type: "sourceFile" };
  if (platform === "web" && ["expo-blur", "expo-haptics", "expo-linear-gradient", "lottie-react-native"].includes(moduleName)) return { filePath: nativeLeafStub, type: "sourceFile" };
  if (platform === "web" && (moduleName === "react-native" || moduleName.startsWith("react-native/"))) {
    const suffix = moduleName === "react-native" ? "" : moduleName.slice("react-native".length);
    return context.resolveRequest(context, `react-native-web${suffix}`, platform);
  }
  return (previousResolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

await Metro.runBuild(config, { entry: path.join(here, "entry.tsx"), platform: "web", minify: false, dev: true, out: outputBundle, sourceMap: false });
const bundle = readFileSync(outputBundle, "utf8");
for (const marker of ["orch-1255-public-venue", "issue-2769-consent-manage", "PUBLIC_VENUE_CONSENT_SAFE_DESKTOP_MIN_WIDTH"]) {
  if (!bundle.includes(marker)) throw new Error(`issue #2769 real-source marker missing: ${marker}`);
}
writeFileSync(path.join(outputDir, "index.html"), readFileSync(path.join(here, "index.html"), "utf8"));
console.log("issue #2769 harness bundled the real consent owner, banner, hook, and shared venue screen.");
