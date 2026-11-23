const { withInfoPlist } = require("@expo/config-plugins");

// #4490 spec 08 O3 part B: Host runs on iPad (ios.supportsTablet true) and
// app.json `orientation` is "default" (the key is not per-platform), which on
// its own would let an iPhone rotate. This plugin writes the iOS orientations
// per device:
//   iPhone  UISupportedInterfaceOrientations       = portrait only (Expo's
//           "portrait" pair, exactly what the portrait-only builds shipped)
//   iPad    UISupportedInterfaceOrientations~ipad  = all four
// Apple: an iPad app that supports multitasking and resizing (no
// UIRequiresFullScreen) must declare all four iPad orientations (App Store
// error ITMS-90474, quoted in @expo/config-plugins ios/RequiresFullScreen.js);
// UIRequiresFullScreen is deprecated in iOS/iPadOS 26 and ignored from 27, so
// it is NOT set here. Android phones are held in portrait at runtime by
// src/hooks/usePhonePortraitLock.ts (shortest side < 600 dp).
const IPHONE_ORIENTATIONS = ["UIInterfaceOrientationPortrait", "UIInterfaceOrientationPortraitUpsideDown"];
const IPAD_ORIENTATIONS = [
  "UIInterfaceOrientationPortrait",
  "UIInterfaceOrientationPortraitUpsideDown",
  "UIInterfaceOrientationLandscapeLeft",
  "UIInterfaceOrientationLandscapeRight",
];

/**
 * @param {Record<string, unknown>} infoPlist
 * @returns {Record<string, unknown>}
 */
const setFloorOrientations = (infoPlist) => ({
  ...infoPlist,
  UISupportedInterfaceOrientations: [...IPHONE_ORIENTATIONS],
  "UISupportedInterfaceOrientations~ipad": [...IPAD_ORIENTATIONS],
});

const withFloorOrientations = (config) =>
  withInfoPlist(config, (next) => {
    next.modResults = setFloorOrientations(next.modResults);
    return next;
  });

module.exports = withFloorOrientations;
module.exports.setFloorOrientations = setFloorOrientations;
module.exports.IPHONE_ORIENTATIONS = IPHONE_ORIENTATIONS;
module.exports.IPAD_ORIENTATIONS = IPAD_ORIENTATIONS;
