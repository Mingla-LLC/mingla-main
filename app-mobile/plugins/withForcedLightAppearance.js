// Issue #2322 — keep the Consumer app's declared light appearance after every
// config plugin has run. expo-splash-screen needs an explicit dark launch colour
// for #2050's launch-identity invariant, but that option also writes
// UIUserInterfaceStyle=Automatic. This plugin is registered after it and owns the
// final Info.plist value. Expo executes same-mod interceptors in reverse plugin
// registration order, so app.json registers this owner before splash.

function forceLightAppearance(infoPlist) {
  infoPlist.UIUserInterfaceStyle = "Light";
  return infoPlist;
}

function withForcedLightAppearance(config) {
  // Keep this require inside the plugin entry point so the pure helper remains
  // executable in the dependency-free #2322 regression suite.
  const { withInfoPlist } = require("@expo/config-plugins");
  return withInfoPlist(config, (cfg) => {
    cfg.modResults = forceLightAppearance(cfg.modResults);
    return cfg;
  });
}

module.exports = withForcedLightAppearance;
module.exports.forceLightAppearance = forceLightAppearance;
