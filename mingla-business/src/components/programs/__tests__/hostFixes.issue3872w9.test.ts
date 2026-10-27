import fs from "node:fs";
import path from "node:path";

import { sectionLabel } from "../contractCopy";
import {
  createFocusRefresher,
  playbackNotice,
  visibleNotice,
} from "../screenLifecycle";
import { brandStatStripItems } from "../../brand/brandStatStrip";

// #3872 Host fixes from the end-to-end simulator walk (B2, B3, B5, B6, B7,
// B8, P2–P5).
const root = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const CONTRACT = "src/components/creators/screens/HostGigContractScreen.tsx";

describe("B2: the iOS time wheel opens in a full-width sheet", () => {
  it("never renders the spinner inline in the half-width Time column", () => {
    const src = read("src/components/programs/TimeField.tsx");
    expect(src).toContain('export function timePickerPresentation');
    expect(src).toMatch(/<ProgramSheet[\s\S]*display="spinner"[\s\S]*<\/ProgramSheet>/);
    expect(src).toMatch(/spinner: \{ alignSelf: "stretch", width: "100%" \}/);
    expect(src).not.toContain('display={Platform.OS === "ios" ? "spinner" : "default"}');
  });
});

describe("B3: hire sheet errors sit above the button in the footer", () => {
  it("passes one footer column: error, then the pay button", () => {
    const src = read("src/components/gigs/HireSheet.tsx");
    expect(src).toContain("<SheetBody title={title} footer={footer}>");
    const footer = src.slice(src.indexOf("const footer = ("));
    const errorAt = footer.indexOf("<FieldError message={error} />");
    const buttonAt = footer.indexOf("Agree and pay");
    expect(errorAt).toBeGreaterThan(-1);
    expect(buttonAt).toBeGreaterThan(errorAt);
  });
});

describe("B5: program sheets close when their screen blurs", () => {
  it("HireSheet and the program screens use ProgramSheet (close on blur)", () => {
    expect(read("src/components/programs/ProgramSheet.tsx")).toContain(
      "useCloseOnBlur(props.visible, props.onClose)",
    );
    expect(read("src/components/gigs/HireSheet.tsx")).toContain("<ProgramSheet");
    for (const file of [
      CONTRACT,
      "src/components/creators/screens/GigApplicantsScreen.tsx",
      "src/components/creators/screens/CreatorRosterScreen.tsx",
      "src/components/creators/screens/GigBriefEditorScreen.tsx",
      "src/components/creators/CreatorsHomeView.tsx",
    ]) {
      const src = read(file);
      expect(src).not.toMatch(/<Sheet\b/);
      expect(src).toContain("<ProgramSheet");
    }
  });
});

describe("B6: live program screens refetch on focus and foreground", () => {
  it("skips the first focus, refetches on refocus and on return to active", () => {
    const refresh = jest.fn();
    const r = createFocusRefresher(refresh, "active");
    r.focus();
    expect(refresh).toHaveBeenCalledTimes(0);
    r.blur();
    r.focus();
    expect(refresh).toHaveBeenCalledTimes(1);
    r.appState("background");
    r.appState("active");
    expect(refresh).toHaveBeenCalledTimes(2);
    r.blur();
    r.appState("background");
    r.appState("active");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("never doubles a refetch that is still in flight", async () => {
    let resolve!: () => void;
    const refresh = jest.fn(() => new Promise<void>((done) => (resolve = done)));
    const r = createFocusRefresher(refresh, "active");
    r.focus();
    r.blur();
    r.focus();
    r.appState("inactive");
    r.appState("active");
    expect(refresh).toHaveBeenCalledTimes(1);
    resolve();
    await Promise.resolve();
    await Promise.resolve();
    r.blur();
    r.focus();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("is wired into gig page, contract, Creators home and Blast Overview", () => {
    expect(read("src/components/creators/screens/GigApplicantsScreen.tsx")).toContain("useRefreshOnFocus(load)");
    expect(read(CONTRACT)).toContain("useRefreshOnFocus(refresh)");
    expect(read("src/components/creators/CreatorsHomeView.tsx")).toContain("useRefreshOnFocus(load)");
    expect(read("src/components/marketing/BlastPromotionOverview.tsx")).toContain(
      "useRefreshOnFocus(query.refetch)",
    );
  });
});

describe("B7: a success notice clears when the contract moves on", () => {
  it("shows only for the state it was stamped with", () => {
    const notice = { text: "The creator can start the script.", state: "script_drafting" };
    expect(visibleNotice(notice, "script_drafting")).toBe(notice.text);
    expect(visibleNotice(notice, "script_sent")).toBeNull();
    expect(visibleNotice(null, "script_sent")).toBeNull();
  });

  it("the contract renders the stamped notice, not a free-floating string", () => {
    const src = read(CONTRACT);
    expect(src).toContain("const notice = visibleNotice(noticeRecord, contractNoticeKey(workspace));");
    expect(src).toContain("loadedState.current = contractNoticeKey(next);");
    expect(src).toContain("state: loadedState.current");
  });
});

describe("B8: brand page numbers are one three-number strip", () => {
  it("Attendees · Sales · Followers with no hint text; Followers opens People", () => {
    const open = jest.fn();
    const items = brandStatStripItems({
      attendees: 1204,
      salesText: "$3,400",
      followers: { total: 87 } as never,
      followersFailed: false,
      onOpenPeople: open,
    });
    expect(items.map((item) => item.label)).toEqual(["Attendees", "Sales", "Followers"]);
    expect(items.map((item) => item.value)).toEqual(["1,204", "$3,400", "87"]);
    expect(JSON.stringify(items)).not.toMatch(/all time|Share your page/);
    items[2].onPress?.();
    expect(open).toHaveBeenCalledTimes(1);
    expect(
      brandStatStripItems({
        attendees: 0,
        salesText: "—",
        followers: undefined,
        followersFailed: true,
      })[2].value,
    ).toBe("—");
  });
});

describe("P2: script parts use the format's section names", () => {
  it("maps keys like the creator app and title-cases unknown keys", () => {
    expect(sectionLabel({ key: "hook" }, 0)).toBe("Hook");
    expect(sectionLabel({ key: "atmosphere" }, 1)).toBe("Atmosphere");
    expect(sectionLabel({ key: "experience" }, 1)).toBe("Experience");
    expect(sectionLabel({ key: "cta" }, 2)).toBe("End card");
    expect(sectionLabel({ key: "middle" }, 1)).toBe("Middle");
    expect(sectionLabel({ key: "price_hook" }, 0)).toBe("Price hook");
    expect(sectionLabel({}, 2)).toBe("Part 3");
  });
});

describe("P3: the video review tile is centred at full width, 9:16", () => {
  it("stretches to the card's content width", () => {
    const src = read(CONTRACT);
    const player = src.slice(src.indexOf("  player: {"), src.indexOf("  playerCaption:"));
    expect(player).toContain('alignSelf: "stretch"');
    expect(player).toContain("aspectRatio: 9 / 16");
    expect(player).not.toContain("maxHeight");
  });
});

describe("P4: processing vs ready-but-unplayable", () => {
  it("says which one it is", () => {
    expect(playbackNotice("processing", null)).toBe(
      "The video is still processing. Try again in a minute.",
    );
    expect(playbackNotice("ready", null)).toBe(
      "We can't play this video right now. Try again soon.",
    );
    expect(playbackNotice("ready", "https://video.example/x.m3u8")).toBeNull();
    expect(read(CONTRACT)).toContain("setNotice(playbackNotice(status, url))");
  });
});

describe("P5: change the video-due date", () => {
  it("renames the post-by copy", () => {
    const src = read(CONTRACT);
    expect(src).toContain('label="Change the video-due date"');
    expect(src).not.toContain("Change the post-by date");
  });
});
