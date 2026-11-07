const { withGradleProperties } = require("@expo/config-plugins");

// #4271: the Stripe Terminal React Native library declares minSdk 26, so the
// app's Android manifest merge fails at Expo's default of 24. Expo's gradle
// plugin reads this exact property (the one expo-build-properties writes); this
// app has no dependency on that package, so a local plugin sets it the same way.
const MIN_SDK_KEY = "android.minSdkVersion";
const MIN_SDK = 26;

/**
 * Raises android.minSdkVersion to 26. A higher value already set is kept.
 *
 * @param {Array<{ type: string, key?: string, value?: string }>} properties
 * @returns {Array<{ type: string, key?: string, value?: string }>}
 */
const ensureMinSdkProperty = (properties) => {
  const existing = properties.find(
    (item) => item.type === "property" && item.key === MIN_SDK_KEY,
  );
  if (existing === undefined) {
    return [...properties, { type: "property", key: MIN_SDK_KEY, value: String(MIN_SDK) }];
  }
  const current = Number.parseInt(existing.value ?? "", 10);
  if (Number.isInteger(current) && current >= MIN_SDK) return properties;
  return properties.map((item) =>
    item === existing ? { ...item, value: String(MIN_SDK) } : item,
  );
};

const withAndroidMinSdk26 = (config) =>
  withGradleProperties(config, (next) => {
    next.modResults = ensureMinSdkProperty(next.modResults);
    return next;
  });

module.exports = withAndroidMinSdk26;
module.exports.ensureMinSdkProperty = ensureMinSdkProperty;
module.exports.MIN_SDK = MIN_SDK;
