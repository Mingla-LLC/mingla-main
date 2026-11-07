/**
 * #4304 part 3 — First Home with Ari: the stage, the tabs, the Home redirect
 * and the greeting copy.
 *
 * fails-on-revert: make `firstRunVisibleTabs` return the rank set unchanged, or
 * `firstRunRedirect` return null, or drop the `homeUnlocked` early return in
 * `deriveFirstRunStage`, and the matching block goes red.
 */
import fs from "fs";
import path from "path";

jest.mock("@react-native-async-storage/async-storage", () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: async (k: string) => store.get(k) ?? null,
      setItem: async (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: async (k: string) => {
        store.delete(k);
      },
    },
  };
});

import {
  deriveFirstRunStage,
  emptyBrandChips,
  firstRunGreeting,
  firstRunRedirect,
  firstRunVisibleTabs,
  isFirstRunLocked,
  type FirstRunInput,
} from "../firstRunState";
import { visibleTabsForRank } from "../navTabGate";
import { BRAND_ROLE_RANK } from "../brandRole";
import { useFirstRunStore } from "../../store/firstRunStore";
import { useAriSeedStore } from "../../store/ariSeedStore";

const TABS = [
  { id: "home", icon: "home", label: "Home" },
  { id: "hub", icon: "calendar", label: "Hub" },
  { id: "ari", icon: "sparkle", label: "Ari" },
  { id: "marketing", icon: "send", label: "Blast" },
  { id: "account", icon: "user", label: "Account" },
] as const;
type Tab = (typeof TABS)[number];

const base: FirstRunInput = {
  signedIn: true,
  storeHydrated: true,
  homeUnlocked: false,
  brandsFetched: true,
  brandCount: 1,
  brandResolving: false,
  hasCurrentBrand: true,
  roleLoading: false,
  rank: BRAND_ROLE_RANK.brand_owner,
  contentFound: false,
  contentKnown: true,
};

const ids = (tabs: readonly { id: string }[]): string[] => tabs.map((t) => t.id);
const tabsFor = (stage: ReturnType<typeof deriveFirstRunStage>, rank: number): string[] =>
  ids(
    firstRunVisibleTabs(
      visibleTabsForRank(TABS as unknown as Tab[], rank),
      TABS as unknown as Tab[],
      stage,
    ),
  );

describe("#4304 deriveFirstRunStage", () => {
  it("State A: signed in, brands fetched, zero brands", () => {
    expect(deriveFirstRunStage({ ...base, brandCount: 0, hasCurrentBrand: false })).toBe("no_brand");
  });

  it("State B: an owner's brand with nothing made", () => {
    expect(deriveFirstRunStage(base)).toBe("empty_brand");
  });

  it("State C: any draft or listing unlocks, even before roles load", () => {
    expect(deriveFirstRunStage({ ...base, contentFound: true })).toBe("unlocked");
    expect(
      deriveFirstRunStage({ ...base, contentFound: true, roleLoading: true, contentKnown: false }),
    ).toBe("unlocked");
  });

  it("once Home appeared it stays, even with no content left", () => {
    expect(
      deriveFirstRunStage({ ...base, homeUnlocked: true, contentFound: false, brandCount: 0 }),
    ).toBe("unlocked");
  });

  it("loading never reads as first run (no flash of the reduced tabs)", () => {
    expect(deriveFirstRunStage({ ...base, signedIn: false })).toBe("pending");
    expect(deriveFirstRunStage({ ...base, storeHydrated: false, brandCount: 0 })).toBe("pending");
    expect(deriveFirstRunStage({ ...base, brandsFetched: false, brandCount: 0 })).toBe("pending");
    expect(deriveFirstRunStage({ ...base, brandResolving: true, brandCount: 0 })).toBe("pending");
    expect(deriveFirstRunStage({ ...base, roleLoading: true })).toBe("pending");
    expect(deriveFirstRunStage({ ...base, hasCurrentBrand: false })).toBe("pending");
    expect(deriveFirstRunStage({ ...base, contentKnown: false })).toBe("pending");
  });

  it("a failed probe fails open to today's screens", () => {
    expect(
      deriveFirstRunStage({ ...base, contentKnown: false, contentError: true }),
    ).toBe("not_applicable");
  });

  it("staff on someone else's brand keep their screens", () => {
    for (const rank of [
      BRAND_ROLE_RANK.scanner,
      BRAND_ROLE_RANK.venue_staff,
      BRAND_ROLE_RANK.marketing_manager,
    ]) {
      expect(deriveFirstRunStage({ ...base, rank })).toBe("not_applicable");
    }
    expect(deriveFirstRunStage({ ...base, rank: BRAND_ROLE_RANK.finance_manager })).toBe(
      "empty_brand",
    );
  });

  it("only A and B lock", () => {
    expect(isFirstRunLocked("no_brand")).toBe(true);
    expect(isFirstRunLocked("empty_brand")).toBe(true);
    for (const s of ["pending", "unlocked", "not_applicable"] as const) {
      expect(isFirstRunLocked(s)).toBe(false);
    }
  });
});

describe("#4304 tab visibility per stage and rank", () => {
  it("A: rank-0 host sees Ari + Account, Ari first", () => {
    expect(tabsFor("no_brand", 0)).toEqual(["ari", "account"]);
  });
  it("B: owner sees Ari + Account only", () => {
    expect(tabsFor("empty_brand", BRAND_ROLE_RANK.brand_owner)).toEqual(["ari", "account"]);
  });
  it("C and pending: the existing role rules, unchanged", () => {
    expect(tabsFor("unlocked", BRAND_ROLE_RANK.brand_owner)).toEqual([
      "home",
      "hub",
      "ari",
      "marketing",
      "account",
    ]);
    expect(tabsFor("pending", BRAND_ROLE_RANK.brand_owner)).toEqual([
      "home",
      "hub",
      "ari",
      "marketing",
      "account",
    ]);
    expect(tabsFor("not_applicable", BRAND_ROLE_RANK.scanner)).toEqual(["home", "account"]);
    expect(tabsFor("not_applicable", BRAND_ROLE_RANK.venue_staff)).toEqual(["home", "account"]);
    expect(tabsFor("unlocked", BRAND_ROLE_RANK.marketing_manager)).toEqual([
      "home",
      "marketing",
      "account",
    ]);
  });
});

describe("#4304 Home redirect while locked", () => {
  it("sends /home (links, pushes, the #4237 fallback) to Ari", () => {
    expect(firstRunRedirect("/home", "no_brand")).toBe("/(tabs)/ari");
    expect(firstRunRedirect("/home/", "empty_brand")).toBe("/(tabs)/ari");
    expect(firstRunRedirect("/HOME", "empty_brand")).toBe("/(tabs)/ari");
  });
  it("never moves anyone else, or a locked host off another screen", () => {
    expect(firstRunRedirect("/home", "unlocked")).toBeNull();
    expect(firstRunRedirect("/home", "pending")).toBeNull();
    expect(firstRunRedirect("/home", "not_applicable")).toBeNull();
    expect(firstRunRedirect("/ari", "no_brand")).toBeNull();
    expect(firstRunRedirect("/account", "no_brand")).toBeNull();
    expect(firstRunRedirect("/event/create", "empty_brand")).toBeNull();
  });
});

describe("#4304 greeting copy and chips", () => {
  it("A: first name, brand-first body, six chips with Set up my brand primary", () => {
    const copy = firstRunGreeting({
      stage: "no_brand",
      displayName: "Tobi Adeyemi",
      brandName: null,
      remembered: null,
    });
    expect(copy.headline).toBe("Hi Tobi. Let's get your business on Mingla.");
    expect(copy.body).toBe(
      "First we set up your brand: name, logo and where you host. It takes about two minutes, and I'll do the typing.",
    );
    expect(copy.chips.map((c) => c.label)).toEqual([
      "Set up my brand",
      "I host events",
      "I run experiences",
      "I run trips",
      "I run a venue",
      "What is Mingla?",
    ]);
    expect(copy.chips.filter((c) => c.primary).map((c) => c.id)).toEqual(["brand"]);
  });

  it("A: never greets by an email address", () => {
    expect(
      firstRunGreeting({ stage: "no_brand", displayName: "tobi@x.com", brandName: null, remembered: null })
        .headline,
    ).toBe("Hi. Let's get your business on Mingla.");
  });

  it("B: names the brand, five chips, ticketed event primary by default", () => {
    const copy = firstRunGreeting({
      stage: "empty_brand",
      displayName: "Tobi",
      brandName: "Wythe Hospitality",
      remembered: null,
    });
    expect(copy.headline).toBe("Wythe Hospitality is set up. What are you hosting first?");
    expect(copy.body).toBe(
      "Tell me the idea in a sentence. I'll draft it, and you check it before anything goes public.",
    );
    expect(copy.chips.map((c) => c.label)).toEqual([
      "An event with tickets",
      "A free RSVP",
      "An experience",
      "A trip",
      "A venue page",
    ]);
    expect(copy.chips.filter((c) => c.primary).map((c) => c.id)).toEqual(["events"]);
  });

  it("B: what the host said in A becomes the primary chip", () => {
    expect(emptyBrandChips("venue").filter((c) => c.primary).map((c) => c.id)).toEqual(["venue"]);
    expect(emptyBrandChips("about").filter((c) => c.primary).map((c) => c.id)).toEqual(["events"]);
  });
});

describe("#4304 firstRunStore", () => {
  beforeEach(() => useFirstRunStore.getState().reset());

  it("unlock is per account and survives until sign-out", () => {
    useFirstRunStore.getState().markUnlocked("u1");
    expect(useFirstRunStore.getState().unlockedUserIds).toEqual({ u1: true });
    useFirstRunStore.getState().reset();
    expect(useFirstRunStore.getState().unlockedUserIds).toEqual({});
  });

  it("the Ari seed is handed over exactly once", () => {
    useAriSeedStore.getState().setSeed("Draft my Friday party");
    expect(useAriSeedStore.getState().takeSeed()).toBe("Draft my Friday party");
    expect(useAriSeedStore.getState().takeSeed()).toBeNull();
  });

  it("sign-out clears it (Constitution #6)", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "../clearAllStores.ts"), "utf8");
    expect(src).toMatch(/useFirstRunStore\.getState\(\)\.reset\(\)/);
    expect(src).toMatch(/useAriSeedStore\.getState\(\)\.reset\(\)/);
  });
});

describe("#4304 wiring", () => {
  const layout = fs.readFileSync(
    path.resolve(__dirname, "../../../app/(tabs)/_layout.tsx"),
    "utf8",
  );
  it("the (tabs) layout filters tabs and redirects Home by the first-run stage", () => {
    expect(layout).toMatch(/firstRunVisibleTabs\(/);
    expect(layout).toMatch(/firstRunRedirect\(pathname, firstRun\.stage\)/);
    expect(layout).toMatch(/<Redirect href=\{firstRunTarget as never\} \/>/);
    expect(layout).toMatch(/FIRST_RUN_DEFAULT_TAB_ID : DEFAULT_TAB_ID/);
  });
});
