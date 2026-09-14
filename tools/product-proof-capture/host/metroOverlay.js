const path = require("node:path");

module.exports = function applyHostCaptureOverlay(config, workspaceRoot) {
  const adapters = path.join(workspaceRoot, "tools/product-proof-capture/host/adapters.ts");
  const router = path.join(workspaceRoot, "tools/product-proof-capture/shared/expoRouterAdapter.tsx");
  const original = config.resolver.resolveRequest;
  const adapterModules = new Set([
    "@react-native-community/netinfo",
    "../../hooks/useEventOrders", "../../context/AuthContext", "../../store/currentBrandStore",
    "../../services/socialProofService", "../../hooks/usePublicTicketCheckoutRouteAccess",
    "../../analytics/webAnalytics", "../../services/rsvpEvents", "../../services/rsvpPassRecoveryService",
    "../../utils/openMapsTarget", "../../utils/copyAddressText", "../../utils/shareCanonicalPublicPageOnWeb",
    "../../theme/useThemeFont",
  ]);
  config.watchFolders = [...new Set([...(config.watchFolders || []), path.join(workspaceRoot, "tools/product-proof-capture")])];
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === "expo-router" || moduleName === "expo-router/head") return { filePath: router, type: "sourceFile" };
    if (adapterModules.has(moduleName)) return { filePath: adapters, type: "sourceFile" };
    return original ? original(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  };
  return config;
};
