const path = require("node:path");

module.exports = function applyExplorerCaptureOverlay(config, workspaceRoot) {
  const adapters = path.join(workspaceRoot, "tools/product-proof-capture/explorer/adapters.ts");
  const router = path.join(workspaceRoot, "tools/product-proof-capture/shared/expoRouterAdapter.tsx");
  const original = config.resolver.resolveRequest;
  const adapterModules = new Set([
    "../../services/mixpanelService", "../../services/appsFlyerService", "../../services/cardEngagementService",
    "../../store/appStore", "../store/appStore", "../../hooks/useFeatureGate", "../../hooks/useKeyboard",
    "../hooks/useUserLocation", "../hooks/useVenueReservable", "../hooks/useReplaceStop",
    "../contexts/RecommendationsContext", "../../services/contentShareController",
    "../../services/calendarService", "../services/calendarService", "../../services/savedCardsService",
    "../services/weatherService", "../../services/weatherService", "../services/busynessService", "../../services/busynessService",
    "../services/deviceCalendarService", "../../services/deviceCalendarService", "../ui/Toast", "./ui/Toast",
    "../../services/boardMessageService", "../../services/realtimeService", "../../services/boardErrorHandler",
    "../../services/networkMonitor", "../../services/supabase", "../services/supabase",
    "../../services/rsvpDeckService", "../../services/postHogService", "../../utils/openMapsTarget", "../utils/openMapsTarget",
    "@react-native-community/netinfo",
  ]);
  config.watchFolders = [...new Set([...(config.watchFolders || []), path.join(workspaceRoot, "tools/product-proof-capture")])];
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName === "expo-router" || moduleName === "expo-router/head") return { filePath: router, type: "sourceFile" };
    if (adapterModules.has(moduleName)) return { filePath: adapters, type: "sourceFile" };
    return original ? original(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  };
  return config;
};
