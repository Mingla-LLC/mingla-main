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

// #4389 — the host setup words ride in the same lazy language file.
export default {
  id: { ...id, ...idSetup },
  ig: { ...ig, ...igSetup },
  it: { ...it, ...itSetup },
  ja: { ...ja, ...jaSetup },
  ko: { ...ko, ...koSetup },
  ms: { ...ms, ...msSetup },
  nl: { ...nl, ...nlSetup },
  pl: { ...pl, ...plSetup },
  pt: { ...pt, ...ptSetup },
  ro: { ...ro, ...roSetup },
};
