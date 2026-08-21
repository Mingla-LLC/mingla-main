// Issue #2343 — keep the Host app's native appearance fixed to Light after
// every config plugin has run. The explicit dark splash block is required by
// #2050, but expo-splash-screen also writes UIUserInterfaceStyle=Automatic.
// Expo executes same-mod interceptors in reverse registration order, so Host
// registers this owner before splash and this mutation executes last.

function forceLightAppearance(infoPlist) {
  infoPlist.UIUserInterfaceStyle = "Light";
  return infoPlist;
}

function withForcedLightAppearance(config) {
  // Keep this require inside the plugin entry point so the pure helper remains
  // executable in the dependency-free #2343 regression suite.
  const { withInfoPlist } = require("@expo/config-plugins");
  return withInfoPlist(config, (cfg) => {
    cfg.modResults = forceLightAppearance(cfg.modResults);
    return cfg;
  });
}

module.exports = withForcedLightAppearance;
module.exports.forceLightAppearance = forceLightAppearance;
