// ORCH-0977 — strip SYSTEM_ALERT_WINDOW from the merged AndroidManifest at prebuild.
//
// Expo's @expo/config-plugins/withAndroidBaseMods ships a default manifest template
// that injects <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>
// as an "OPTIONAL PERMISSION — REMOVE WHATEVER YOU DO NOT NEED". Mingla does not draw
// overlays, never calls Settings.ACTION_MANAGE_OVERLAY_PERMISSION, and never invokes
// canDrawOverlays(). The permission has zero functional use here and shows up on the
// Play Store listing as the user-facing string "Display over other apps", which is
// confusing for a date-planning app.
//
// This plugin removes the permission entry every time `expo prebuild` runs (every
// EAS cloud build), so the published AAB ships without it.

const { withAndroidManifest } = require('@expo/config-plugins')

module.exports = function withoutSystemAlertWindow(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest
    if (Array.isArray(manifest['uses-permission'])) {
      manifest['uses-permission'] = manifest['uses-permission'].filter(
        (perm) => perm.$['android:name'] !== 'android.permission.SYSTEM_ALERT_WINDOW',
      )
    }
    return cfg
  })
}
