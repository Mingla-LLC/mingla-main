import id from "./locales/id/brandGroupMedia.json";
import ig from "./locales/ig/brandGroupMedia.json";
import it from "./locales/it/brandGroupMedia.json";
import ja from "./locales/ja/brandGroupMedia.json";
import ko from "./locales/ko/brandGroupMedia.json";
import ms from "./locales/ms/brandGroupMedia.json";
import nl from "./locales/nl/brandGroupMedia.json";
import pl from "./locales/pl/brandGroupMedia.json";
import pt from "./locales/pt/brandGroupMedia.json";
import ro from "./locales/ro/brandGroupMedia.json";

import idSetup from "./locales/id/hostSetup.json";
import igSetup from "./locales/ig/hostSetup.json";
import itSetup from "./locales/it/hostSetup.json";
import jaSetup from "./locales/ja/hostSetup.json";
import koSetup from "./locales/ko/hostSetup.json";
import msSetup from "./locales/ms/hostSetup.json";
import nlSetup from "./locales/nl/hostSetup.json";
import plSetup from "./locales/pl/hostSetup.json";
import ptSetup from "./locales/pt/hostSetup.json";
import roSetup from "./locales/ro/hostSetup.json";

// #4238 W6a — the Promote builder words ride in the same lazy language file.
import idAds from "./locales/id/hostAds.json";
import igAds from "./locales/ig/hostAds.json";
import itAds from "./locales/it/hostAds.json";
import jaAds from "./locales/ja/hostAds.json";
import koAds from "./locales/ko/hostAds.json";
import msAds from "./locales/ms/hostAds.json";
import nlAds from "./locales/nl/hostAds.json";
import plAds from "./locales/pl/hostAds.json";
import ptAds from "./locales/pt/hostAds.json";
import roAds from "./locales/ro/hostAds.json";

// #4389 — the host setup words ride in the same lazy language file.
export default {
  id: { ...id, ...idSetup, ...idAds },
  ig: { ...ig, ...igSetup, ...igAds },
  it: { ...it, ...itSetup, ...itAds },
  ja: { ...ja, ...jaSetup, ...jaAds },
  ko: { ...ko, ...koSetup, ...koAds },
  ms: { ...ms, ...msSetup, ...msAds },
  nl: { ...nl, ...nlSetup, ...nlAds },
  pl: { ...pl, ...plSetup, ...plAds },
  pt: { ...pt, ...ptSetup, ...ptAds },
  ro: { ...ro, ...roSetup, ...roAds },
};
