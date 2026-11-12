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

// #4389 — the host setup words ride in the same lazy language file.
export default {
  ru: { ...ru, ...ruSetup },
  sv: { ...sv, ...svSetup },
  th: { ...th, ...thSetup },
  tr: { ...tr, ...trSetup },
  uk: { ...uk, ...ukSetup },
  vi: { ...vi, ...viSetup },
  yo: { ...yo, ...yoSetup },
  zh: { ...zh, ...zhSetup },
};
