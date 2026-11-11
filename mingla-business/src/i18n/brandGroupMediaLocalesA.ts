import ar from "./locales/ar/brandGroupMedia.json";
import bin from "./locales/bin/brandGroupMedia.json";
import bn from "./locales/bn/brandGroupMedia.json";
import de from "./locales/de/brandGroupMedia.json";
import el from "./locales/el/brandGroupMedia.json";
import es from "./locales/es/brandGroupMedia.json";
import fr from "./locales/fr/brandGroupMedia.json";
import ha from "./locales/ha/brandGroupMedia.json";
import he from "./locales/he/brandGroupMedia.json";
import hi from "./locales/hi/brandGroupMedia.json";

import arSetup from "./locales/ar/hostSetup.json";
import binSetup from "./locales/bin/hostSetup.json";
import bnSetup from "./locales/bn/hostSetup.json";
import deSetup from "./locales/de/hostSetup.json";
import elSetup from "./locales/el/hostSetup.json";
import esSetup from "./locales/es/hostSetup.json";
import frSetup from "./locales/fr/hostSetup.json";
import haSetup from "./locales/ha/hostSetup.json";
import heSetup from "./locales/he/hostSetup.json";
import hiSetup from "./locales/hi/hostSetup.json";

// #4389 — the host setup words ride in the same lazy language file.
export default {
  ar: { ...ar, ...arSetup },
  bin: { ...bin, ...binSetup },
  bn: { ...bn, ...bnSetup },
  de: { ...de, ...deSetup },
  el: { ...el, ...elSetup },
  es: { ...es, ...esSetup },
  fr: { ...fr, ...frSetup },
  ha: { ...ha, ...haSetup },
  he: { ...he, ...heSetup },
  hi: { ...hi, ...hiSetup },
};
