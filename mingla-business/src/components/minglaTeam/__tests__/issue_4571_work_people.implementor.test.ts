/**
 * #4571 W1 — Host app > Mingla team > Work updates: the card sheet names
 * every owner and every watcher.
 *
 *   P-1  names come from the server's owners / watchers lists
 *   P-2  a server without the lists (before #4571) still shows its single
 *        owner and watcher, in the words every language already has
 *   P-3  "—" stands for nobody (never made-up names)
 *   P-4  the English words exist; other languages fall back to them
 *
 * FAILS-ON-REVERT: on origin/main cardPeopleWords does not exist and the
 * sheet reads only card.owner / card.watcher.
 */
import fs from "node:fs";
import path from "node:path";

import { cardPeopleWords } from "../workUpdates";

const root = path.resolve(__dirname, "../../../i18n/locales");
const en = JSON.parse(fs.readFileSync(path.join(root, "en/teamChat.json"), "utf8")).team as Record<string, string>;
// The Host app translator's rules: count picks _one / _other, then the bare key.
const t = ((key: string, values?: Record<string, string | number>) => {
  const k = key.replace(/^team\./, "");
  const count = values?.count;
  const tpl = (typeof count === "number" ? en[`${k}_${count === 1 ? "one" : "other"}`] ?? en[`${k}_other`] : undefined) ?? en[k] ?? key;
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, v: string) => String(values?.[v] ?? ""));
}) as never;

const card = (extra: Record<string, unknown>) => ({ owner: null, watcher: null, ...extra }) as never;

describe("P-1 every owner and watcher", () => {
  test("two owners and one watcher", () => {
    expect(cardPeopleWords(card({ owner: "Ada", watcher: "Kemi", owners: ["Ada", "Tunde"], watchers: ["Kemi"] }), t)).toBe("Ada and Tunde own · Kemi watches");
  });
  test("three owners and two watchers", () => {
    expect(cardPeopleWords(card({ owners: ["Ada", "Tunde", "Bo"], watchers: ["Kemi", "Zed"] }), t)).toBe("Ada, Tunde and Bo own · Kemi and Zed watch");
  });
  test("one of each from the lists keeps the old words", () => {
    expect(cardPeopleWords(card({ owner: "Ada", watcher: "Kemi", owners: ["Ada"], watchers: ["Kemi"] }), t)).toBe("Ada owns · Kemi watches");
  });
});

describe("P-2 older servers", () => {
  test("no lists: the single keys", () => {
    expect(cardPeopleWords(card({ owner: "Ada", watcher: "Kemi" }), t)).toBe("Ada owns · Kemi watches");
    expect(cardPeopleWords(card({ owner: "Ada", watcher: "Kemi", owners: [], watchers: null }), t)).toBe("Ada owns · Kemi watches");
  });
});

describe("P-3 nobody is a dash", () => {
  test("empty", () => {
    expect(cardPeopleWords(card({}), t)).toBe("— owns · — watches");
    expect(cardPeopleWords(card({ owners: ["Ada", "Tunde"], watchers: [] }), t)).toBe("Ada and Tunde own · — watches");
  });
});

describe("P-4 the words", () => {
  test("English has every key the sheet uses, and the sheet uses them", () => {
    for (const k of ["card_people", "card_people_list", "card_owners_one", "card_owners_other", "card_watchers_one", "card_watchers_other", "names_and"]) {
      expect(en[k]).toBeTruthy();
    }
    const screen = fs.readFileSync(path.resolve(__dirname, "../TeamScreens.tsx"), "utf8");
    expect(screen).toContain("{cardPeopleWords(card, t)}");
    expect(screen).not.toContain('t("team.card_people", { owner: card.owner');
  });
});
