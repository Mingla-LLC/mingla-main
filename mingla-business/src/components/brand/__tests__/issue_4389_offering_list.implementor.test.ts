/**
 * #4389 addendum 2 — "What do you want to make first?" is one list of five
 * with silent looping clips, everywhere OfferingChooser is used; F4 puts the
 * Tap to Pay on iPhone card above it.
 */
import { describe, expect, jest, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";

jest.mock("../../ui/Icon", () => ({ Icon: () => null }));
jest.mock("expo-haptics", () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Medium: "Medium" } }));

// eslint-disable-next-line import/first
import { OFFERING_OPTIONS, routeForOffering } from "../OfferingChooser";

const read = (rel: string): string => fs.readFileSync(path.join(__dirname, "..", rel), "utf8");

describe("#4389 offering list of 5", () => {
  test("order, labels and unchanged subheads", () => {
    expect(OFFERING_OPTIONS.map((o) => [o.kind, o.rowLabel])).toEqual([
      ["event", "An event"],
      ["experience", "An experience"],
      ["trip", "A trip"],
      ["rsvp", "An RSVP"],
      ["venue", "A venue"],
    ]);
    expect(OFFERING_OPTIONS.find((o) => o.kind === "rsvp")?.subhead).toBe("Free guest list; optional chip-ins.");
    for (const o of OFFERING_OPTIONS) expect(routeForOffering(o.kind)).toMatch(/^\/[a-z]+\/create$/);
  });
  test("every clip and poster is bundled", () => {
    for (const kind of ["event", "experience", "trip", "rsvp", "venue"]) {
      for (const ext of ["mp4", "jpg"]) {
        expect(fs.existsSync(path.join(__dirname, "../../../../assets/offerings", `offer-${kind}.${ext}`))).toBe(true);
      }
    }
  });
  test("clips: expo-video, muted, looped, mixed with other audio; paused unless active; poster under Reduce Motion or error", () => {
    const clip = read("OfferingClip.native.tsx");
    expect(clip).toContain('from "expo-video"');
    expect(clip).toContain("instance.loop = true;");
    expect(clip).toContain("instance.muted = true;");
    expect(clip).toContain('instance.audioMixingMode = "mixWithOthers";');
    expect(clip).toContain("const play = active && reduceMotion === false && !failed;");
    expect(clip).toContain("else player.pause();");
    expect(clip).toContain('if (status === "error")');
    // The poster is always drawn under the video.
    expect(clip.indexOf("<Image source={poster}")).toBeLessThan(clip.indexOf("<VideoView"));
    // Web and node runs draw the poster only.
    expect(read("OfferingClip.tsx")).not.toContain("expo-video");
  });
  test("the chooser plays only while the app is in the foreground", () => {
    const chooser = read("OfferingChooser.tsx");
    expect(chooser).toContain('AppState.addEventListener("change"');
    expect(chooser).toContain("active={appActive}");
  });
  test("F4: Tap to Pay on iPhone card (iOS, eligible brands) sits above the list", () => {
    const flow = read("BrandCreationFlow.tsx");
    expect(flow).toContain('const showTtp = Platform.OS === "ios" && ttpEntry !== null &&');
    expect(flow.indexOf('testID="brand-setup-ttp-card"')).toBeLessThan(flow.indexOf("<OfferingChooser"));
    expect(flow).toContain("{C.f4.ttpCta}".replace("{C.f4.ttpCta}", "label={C.f4.ttpCta}"));
  });
});

describe("#4389 flow polish (items 1–5)", () => {
  const flow = read("BrandCreationFlow.tsx");
  test("U-6: desktop web gets a left step rail beside a 560 pane", () => {
    expect(flow).toContain('testID="brand-setup-rail"');
    expect(flow).toContain("pane: { flex: 1, maxWidth: 560 },");
  });
  test("K1 on Back from Get paid", () => {
    expect(flow).toContain('else if (step === "pay") setK1("pay");');
  });
});
