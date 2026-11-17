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

// #4238 W6a — the Promote builder words ride in the same lazy language file.
import arAds from "./locales/ar/hostAds.json";
import binAds from "./locales/bin/hostAds.json";
import bnAds from "./locales/bn/hostAds.json";
import deAds from "./locales/de/hostAds.json";
import elAds from "./locales/el/hostAds.json";
import esAds from "./locales/es/hostAds.json";
import frAds from "./locales/fr/hostAds.json";
import haAds from "./locales/ha/hostAds.json";
import heAds from "./locales/he/hostAds.json";
import hiAds from "./locales/hi/hostAds.json";

// #4389 — the host setup words ride in the same lazy language file.
export default {
  ar: { ...ar, ...arSetup, ...arAds },
  bin: { ...bin, ...binSetup, ...binAds },
  bn: { ...bn, ...bnSetup, ...bnAds },
  de: { ...de, ...deSetup, ...deAds },
  el: { ...el, ...elSetup, ...elAds },
  es: { ...es, ...esSetup, ...esAds },
  fr: { ...fr, ...frSetup, ...frAds },
  ha: { ...ha, ...haSetup, ...haAds },
  he: { ...he, ...heSetup, ...heAds },
  hi: { ...hi, ...hiSetup, ...hiAds },
};
