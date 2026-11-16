/**
 * #4420 device round 3 — two defects seen on the iOS simulator while creating
 * an event.
 *
 * 1. Keyboard: on the full-screen event wizard (not a sheet) the Basics
 *    Description box's lower edge sat under the app-drawn Done bar. Root
 *    cause: the shared SmartScrollView only reserved the bar for sheets. Its
 *    keyboard spacer was the keyboard height alone, so a `scrollToEnd` reveal
 *    landed content flush on the keyboard top, behind the bar; and the
 *    multiline caret-on-first-line correction (focusedFieldTail) ran inside
 *    sheets only. Now every full-screen container adds the Done bar plus the
 *    clearance to its keyboard spacer, and every container applies the tail.
 *
 * 2. Invite step dead end: when the delivery estimate failed, Back was greyed
 *    out (Back was held whenever the invite step was not "ready") and the only
 *    action was "Try again". Back and stepper jumps are now held only while
 *    the invite selection is actually saving, in all four creation wizards.
 *
 * 3. Stay: a room's "Make live" before the Stay is published failed with
 *    "Finish the listed readiness items", though no item was listed. The
 *    refusal now says to publish the stay first.
 *
 * FAILS ON REVERT: drop the spacer or the sheet exemption, gate the tail on a
 * sheet again, or put any wizard's Back / step jump back on
 * `phase !== "ready"`, and the matching assertion goes red.
 */
import fs from "fs";
import path from "path";
import { describe, expect, jest, test } from "@jest/globals";

jest.mock("react-native-keyboard-controller", () => ({
  KeyboardAwareScrollView: "KeyboardAwareScrollView@library",
  FocusedInputEvents: { addListener: () => ({ remove: () => undefined }) },
  useReanimatedFocusedInput: () => ({ input: null }),
}));

type Element = { type: unknown; props: Record<string, unknown> };
type WrapperModule = {
  smartScrollElement: (p: Record<string, unknown>, r: null, extra: number, inSheet?: boolean) => Element;
  SCREEN_KEYBOARD_EXTRA_SPACE: number;
  DONE_BAR_OCCUPIED: number;
  MIN_VISIBLE_CLEARANCE: number;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const wrapper = require("../../../wrappers/SmartScrollView.native") as WrapperModule;

const read = (rel: string): string => fs.readFileSync(path.resolve(__dirname, "../../../..", rel), "utf8");

describe("#4420 round 3: full-screen scroll views clear the Done bar", () => {
  test("the spacer is the Done bar plus the visible clearance", () => {
    expect(wrapper.SCREEN_KEYBOARD_EXTRA_SPACE).toBe(wrapper.DONE_BAR_OCCUPIED + wrapper.MIN_VISIBLE_CLEARANCE);
    expect(wrapper.SCREEN_KEYBOARD_EXTRA_SPACE).toBeGreaterThan(0);
  });

  test("outside a sheet the keyboard spacer reserves the Done bar", () => {
    const element = wrapper.smartScrollElement({}, null, 0);
    expect(element.type).toBe("KeyboardAwareScrollView@library");
    expect(element.props.extraKeyboardSpace).toBe(wrapper.SCREEN_KEYBOARD_EXTRA_SPACE);
  });

  test("inside a sheet the body already pads for the bar, so no second spacer", () => {
    expect(wrapper.smartScrollElement({}, null, 0, true).props.extraKeyboardSpace).toBe(0);
  });

  test("a caller's own spacer still wins", () => {
    expect(wrapper.smartScrollElement({ extraKeyboardSpace: 7 }, null, 0).props.extraKeyboardSpace).toBe(7);
  });

  test("the multiline field tail applies in every container, not only sheets", () => {
    const scroll = read("src/wrappers/SmartScrollView.native.tsx");
    expect(scroll).toMatch(/\(sheet === null \? 0 : sheetScrollExtraOffset\(footerGap, sheet\.topShift\)\) \+ fieldTail/);
    const focusEffect = scroll.slice(scroll.indexOf("const readFieldTail"), scroll.indexOf("const setRefs"));
    expect(focusEffect).toMatch(/addListener\("focusDidSet"/);
    expect(focusEffect).not.toMatch(/sheetBottomPad === undefined/);
  });
});

describe("#4420 round 3: Back on the invite step is held only while saving", () => {
  const cases: Array<{ file: string; starts: string[] }> = [
    {
      file: "src/components/event/EventCreatorWizard.tsx",
      starts: ["const handleStepBack", "const handleStepPress", "backDisabled={"],
    },
    {
      file: "src/components/rsvp/RsvpCreatorWizard.tsx",
      starts: ["const handleStepBack", "const handleStepPress", "disabled={currentStep === 5 &&"],
    },
    {
      file: "src/components/experience/ExperienceCreatorWizard.tsx",
      starts: ["const goBack", "const goToStep", "onPress={goBack}"],
    },
    {
      file: "src/components/trip/TripCreatorWizard.tsx",
      starts: ["const handleStepBack", "const handleStepJump", "disabled={submitting || (step === 7"],
    },
  ];
  for (const { file, starts } of cases) {
    test(file, () => {
      const source = read(file);
      for (const start of starts) {
        const at = source.indexOf(start);
        expect(at).toBeGreaterThan(-1);
        const window = source.slice(at, at + 700);
        expect(window).toMatch(/inviteNavigation\?\.phase === "saving"/);
        expect(window).not.toMatch(/inviteNavigation\?\.phase !== "ready"/);
      }
    });
  }
});

describe("#4420 round 3: a room's Make live refusal tells the host what to do", () => {
  test("stay_publish_incomplete names publishing the Stay first", () => {
    const source = read("src/components/stay/StayInventoryManager.tsx");
    const at = source.indexOf('code.includes("stay_publish_incomplete")');
    expect(at).toBeGreaterThan(-1);
    const branch = source.slice(at, at + 400);
    expect(branch).toMatch(/return "Publish the Stay first\./);
    expect(source).not.toMatch(/Finish the listed readiness items before making this live\./);
  });
});
