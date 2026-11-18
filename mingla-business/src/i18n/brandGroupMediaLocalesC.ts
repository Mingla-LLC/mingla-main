import ru from "./locales/ru/brandGroupMedia.json";
import sv from "./locales/sv/brandGroupMedia.json";
import th from "./locales/th/brandGroupMedia.json";
import tr from "./locales/tr/brandGroupMedia.json";
import uk from "./locales/uk/brandGroupMedia.json";
import vi from "./locales/vi/brandGroupMedia.json";
import yo from "./locales/yo/brandGroupMedia.json";
import zh from "./locales/zh/brandGroupMedia.json";

import ruSetup from "./locales/ru/hostSetup.json";
import svSetup from "./locales/sv/hostSetup.json";
import thSetup from "./locales/th/hostSetup.json";
import trSetup from "./locales/tr/hostSetup.json";
import ukSetup from "./locales/uk/hostSetup.json";
import viSetup from "./locales/vi/hostSetup.json";
import yoSetup from "./locales/yo/hostSetup.json";
import zhSetup from "./locales/zh/hostSetup.json";

// #4238 W6a — the Promote builder words ride in the same lazy language file.
import ruAds from "./locales/ru/hostAds.json";
import svAds from "./locales/sv/hostAds.json";
import thAds from "./locales/th/hostAds.json";
import trAds from "./locales/tr/hostAds.json";
import ukAds from "./locales/uk/hostAds.json";
import viAds from "./locales/vi/hostAds.json";
import yoAds from "./locales/yo/hostAds.json";
import zhAds from "./locales/zh/hostAds.json";

// #4389 — the host setup words ride in the same lazy language file.
export default {
  ru: { ...ru, ...ruSetup, ...ruAds },
  sv: { ...sv, ...svSetup, ...svAds },
  th: { ...th, ...thSetup, ...thAds },
  tr: { ...tr, ...trSetup, ...trAds },
  uk: { ...uk, ...ukSetup, ...ukAds },
  vi: { ...vi, ...viSetup, ...viAds },
  yo: { ...yo, ...yoSetup, ...yoAds },
  zh: { ...zh, ...zhSetup, ...zhAds },
};
