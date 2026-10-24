// #3682 — The dormant render lane intentionally reuses Mingla Business's
// installed renderer instead of installing the consumer app. Keep this small
// translation double at that test boundary so consumer screens can exercise
// localized follower copy without adding a second dependency install.
const followers = require("../i18n/locales/en/followers.json");

const interpolate = (value, options = {}) =>
  String(value).replace(/{{\s*(\w+)\s*}}/g, (_match, key) =>
    Object.prototype.hasOwnProperty.call(options, key)
      ? String(options[key])
      : `{{${key}}}`,
  );

const translate = (key, options) => {
  const leaf = key.includes(":") ? key.split(":").at(-1) : key;
  const pluralLeaf =
    typeof options?.count === "number"
      ? `${leaf}_${options.count === 0 ? "zero" : options.count === 1 ? "one" : "other"}`
      : leaf;
  return interpolate(followers[pluralLeaf] ?? followers[leaf] ?? key, options);
};

module.exports = {
  initReactI18next: { type: "3rdParty", init: () => undefined },
  useTranslation: () => ({
    t: translate,
    i18n: { language: "en", resolvedLanguage: "en" },
  }),
};
