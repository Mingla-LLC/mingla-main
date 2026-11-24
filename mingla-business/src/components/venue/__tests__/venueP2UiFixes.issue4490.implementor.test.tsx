/**
 * #4490 P2 click-test fixes (F1-F3, H2-H5, I1-I7): the rule behind each defect,
 * pinned where the fault could recur (the shared picker head, the panel close,
 * the scroll reset, the toast timer, the pill colours, the refund words).
 */
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";

import {
  bookingVat,
  orderLinesByOptions,
  parseEntryQuote,
  summaryLines,
  policyWords,
  refundLadderWords,
  venueAddressLine,
} from "@mingla/brand-rendering/venueOffers/entryModel";

import { touchFloorFor } from "../../../hooks/useTouchFloor";
import { checkInResultView } from "../features/checkin/venueCheckInResult";
import { OFFER_STATUS } from "../features/offers/offersModel";
import { bookingStateLabel } from "../features/today/todayModel";
import { PickerSheetHead } from "../../ui/PickerSheetHead";
import { useScrollToTopOnChange } from "../../ui/useScrollToTopOnChange";
import { useToastTimer } from "../../ui/useToastTimer";
import type { CheckInPass, ScanOutcome } from "../../../types/venueOffers";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Renderer {
  root: { findByProps: (p: Record<string, unknown>) => { props: Record<string, unknown> } };
  update: (el: React.ReactElement) => void;
}
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TestRenderer = require("react-test-renderer") as {
  act: (cb: () => void) => void;
  create: (el: React.ReactElement, opts?: { createNodeMock?: () => unknown }) => Renderer;
};
const act = TestRenderer.act;

const root = path.resolve(__dirname, "../../../..");
const read = (rel: string): string => fs.readFileSync(path.join(root, rel), "utf8");

describe("F2 every picker has a visible Close", () => {
  it("PickerSheetHead renders a Close button that closes", () => {
    const onClose = jest.fn();
    let tree!: Renderer;
    act(() => {
      tree = TestRenderer.create(<PickerSheetHead title="ID to ask for" onClose={onClose} testID="p" />);
    });
    const close = tree.root.findByProps({ testID: "p-close" });
    expect(close.props.accessibilityLabel).toBe("Close");
    act(() => {
      (close.props.onPress as () => void)();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the select list, the time list and the calendar all use it (a new picker must too)", () => {
    for (const file of ["SelectSheet.tsx", "TimeField.tsx", "DayDateField.tsx"]) {
      expect(read(`src/components/ui/${file}`)).toContain("<PickerSheetHead");
    }
  });

  it("a wide side panel always draws its own Close (the scan panel had none)", () => {
    const sheet = read("src/components/ui/Sheet.web.tsx");
    expect(sheet).toContain("sidePanel && !dismissDisabled");
    expect(sheet).toContain('accessibilityLabel="Close"');
  });
});

describe("F3 a new wizard step starts at the top", () => {
  it("scrolls the step's scroll view to 0 when the step changes, not on first render", () => {
    const scrollTo = jest.fn();
    function Probe({ step }: { step: number }): React.ReactElement {
      const ref = useScrollToTopOnChange(step);
      return React.createElement("scroll", { ref });
    }
    let tree!: Renderer;
    act(() => {
      tree = TestRenderer.create(<Probe step={0} />, { createNodeMock: () => ({ scrollTo }) });
    });
    expect(scrollTo).not.toHaveBeenCalled();
    act(() => tree.update(<Probe step={1} />));
    expect(scrollTo).toHaveBeenCalledWith({ x: 0, y: 0, animated: false });
    act(() => tree.update(<Probe step={1} />));
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it("the Entry editor wires it into both of its scroll views", () => {
    const src = read("src/components/venue/features/offers/EntryEditor.tsx");
    expect(src).toContain("useScrollToTopOnChange(stepIndex)");
    expect(src.match(/<ScrollView ref=\{scrollRef\}/g)?.length).toBe(2);
  });
});

describe("ci-ok row admission keeps Undo available", () => {
  it("opens the durable result panel after a list-row admission instead of acknowledging only with a toast", () => {
    const src = read("src/components/venue/features/checkin/VenueCheckInModule.tsx");
    const admitRow = src.match(/const admitRow = useCallback\([\s\S]*?\n  \);/)?.[0] ?? "";
    expect(admitRow).toContain('runDoor({ kind: "admit", passId: pass.passId }, () => setScanOpen(true));');
    expect(admitRow).not.toContain("setToast");
  });
});

describe("F1 Open Terms and tax is a button, not a text link", () => {
  it("uses the secondary button, not ghost", () => {
    const src = read("src/components/venue/features/offers/EntryEditor.tsx");
    expect(src).toMatch(/label="Open Terms and tax" variant="secondary"/);
    expect(src).not.toMatch(/label="Open Settings" variant="ghost"/);
  });
});

describe("I4 a positive state never wears the danger colour", () => {
  it("offer, today and check-in states use the green pill", () => {
    expect(OFFER_STATUS.live.variant).toBe("ok");
    const booking = {
      guests: 3,
      admittedCount: 3,
      state: "confirmed",
      status: "valid",
    } as unknown as Parameters<typeof bookingStateLabel>[0];
    expect(bookingStateLabel(booking).variant).not.toBe("live");
  });

  it("no venue feature screen uses the red live-now pill", () => {
    const dir = path.join(root, "src/components/venue/features");
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "__tests__") walk(p);
        } else if (/\.(ts|tsx)$/.test(entry.name)) files.push(p);
      }
    };
    walk(dir);
    const offenders = files.filter((f) => /variant[:=]\s*\{?\s*"live"|\? "live" :|variant: "live"/.test(fs.readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

describe("H2 the refund line reads the same as the Host review", () => {
  it("builds the sentence from the ladder", () => {
    expect(
      refundLadderWords([
        { minMinutesBefore: 1440, refundBps: 10000 },
        { minMinutesBefore: 0, refundBps: 5000 },
      ]),
    ).toBe("Full refund up to 24 hours before, then 50% back until it starts");
    expect(refundLadderWords([])).toBe("No refunds");
  });

  it("reads a camelCase or snake_case ladder, never the raw day(s) text", () => {
    const camel = policyWords({ text: "Full refund up to 1 day(s) before.", refundLadder: [{ minMinutesBefore: 2880, refundBps: 10000 }] });
    expect(camel).toBe("Full refund up to 2 days before");
    const snake = policyWords({ refundLadder: [{ min_minutes_before: 1440, refund_bps: 10000 }, { min_minutes_before: 0, refund_bps: 5000 }] });
    expect(snake).toBe("Full refund up to 24 hours before, then 50% back until it starts");
  });

  it("repairs the server sentence when there is no ladder", () => {
    expect(policyWords({ text: "Full refund up to 1 day(s) before. 50% refund up to the start." })).toBe(
      "Full refund up to 24 hours before, then 50% back until it starts",
    );
    expect(policyWords({ text: "Full refund up to 3 day(s) before." })).toBe("Full refund up to 3 days before");
    expect(policyWords(null)).toBeNull();
  });
});

describe("H4 the address never repeats the city", () => {
  it("adds the city only when the address does not name it", () => {
    expect(venueAddressLine("14 The Providence St, Lekki, Lagos, Nigeria", "Lagos")).toBe(
      "14 The Providence St, Lekki, Lagos, Nigeria",
    );
    expect(venueAddressLine("14 The Providence St", "Lagos")).toBe("14 The Providence St, Lagos");
    expect(venueAddressLine(null, "Lagos")).toBe("Lagos");
    expect(venueAddressLine("", null)).toBeNull();
  });
});

describe("H5 lines keep the offer's order", () => {
  it("sorts a booking's lines by the offer's price order", () => {
    const lines = [{ priceOptionId: "student" }, { priceOptionId: "walk" }, { priceOptionId: "other" }];
    expect(orderLinesByOptions(lines, ["walk", "student"]).map((l) => l.priceOptionId)).toEqual(["walk", "student", "other"]);
    expect(orderLinesByOptions(lines, []).map((l) => l.priceOptionId)).toEqual(["student", "walk", "other"]);
  });
});

describe("I2 a mixed party says how many guests need the ID", () => {
  const pass = (over: Partial<CheckInPass>): CheckInPass =>
    ({
      passId: "p",
      groupId: null,
      reference: null,
      holderName: "Ada",
      offerName: "Entry",
      offerKind: "entry",
      admits: 3,
      admittedCount: 0,
      remaining: 3,
      validLocalDate: null,
      dayLabel: null,
      idCheckLabel: "Student or NYSC ID",
      idCheckCount: 1,
      status: "valid",
      source: null,
      time: null,
      lastAdmittedAt: null,
      ...over,
    }) as CheckInPass;
  const outcome = (p: CheckInPass): ScanOutcome => ({ result: "id_required", kind: "venue_pass", pass: p, logId: null, admitted: null }) as unknown as ScanOutcome;

  it("1 of 3: names the count, what to do with that guest and that the rest keep their entry", () => {
    const view = checkInResultView(outcome(pass({})));
    expect(view.body).toContain("Ask 1 of 3 guests for Student or NYSC ID");
    expect(view.body).toContain("sell that guest a walk-in ticket");
    expect(view.body).toContain("The other 2 guests keep their entry");
    const two = checkInResultView(outcome(pass({ admits: 2 })));
    expect(two.body).toContain("Ask 1 of 2 guests");
    expect(two.body).toContain("The other guest keeps their entry");
  });

  it("everyone on the ID price keeps the short wording", () => {
    const view = checkInResultView(outcome(pass({ admits: 2, idCheckCount: 2 })));
    expect(view.body).toContain("Ask for Student or NYSC ID");
  });
});

describe("I7 a toast ends on time when the tab comes back", () => {
  it("a countdown that ran out while the tab was hidden ends on visibilitychange", () => {
    jest.useFakeTimers();
    const listeners: Record<string, Array<() => void>> = {};
    const doc = {
      visibilityState: "hidden",
      addEventListener: (t: string, l: () => void) => {
        (listeners[t] ??= []).push(l);
      },
      removeEventListener: () => undefined,
    };
    (globalThis as { document?: unknown }).document = doc;
    const onElapsed = jest.fn();
    function Probe(): null {
      useToastTimer(4000, onElapsed);
      return null;
    }
    act(() => {
      TestRenderer.create(<Probe />);
    });
    // The browser froze its timers: time passes, the timeout never ran.
    const realNow = Date.now;
    Date.now = () => realNow() + 60_000;
    doc.visibilityState = "visible";
    act(() => listeners.visibilitychange?.forEach((l) => l()));
    Date.now = realNow;
    expect(onElapsed).toHaveBeenCalledTimes(1);
    act(() => {
      jest.runOnlyPendingTimers();
    });
    expect(onElapsed).toHaveBeenCalledTimes(1);
    delete (globalThis as { document?: unknown }).document;
    jest.useRealTimers();
  });
});

describe("I1 the venue header follows Admin's decision", () => {
  it("both listing reads refetch when the tab is focused again", () => {
    const src = read("src/hooks/useVenueListings.ts");
    expect(src.match(/refetchOnWindowFocus: "always"/g)?.length).toBe(2);
  });
});

// TEST-MOD-APPROVED #4490 (08-O1 fix 2): spec 08 §13 (decided 22 Nov) keeps
// gate sales while the Till is off, so the gate sale sheet and its pay-code
// Copy link are back (restored from before O1), and the door picks the gate
// sale or the Till by the order pad's switch.
describe("I6 the pay code has a Copy link button", () => {
  it("offers Copy link with the full link and keeps the plain text secondary", () => {
    const src = read("src/components/venue/features/checkin/VenueGateSale.tsx");
    expect(src).toContain('"Copy link"');
    expect(src).toContain("copyPublicUrl(payUrlProof)");
    expect(src).toContain("styles.linkText");
  });

  it("check-in and the scan screen sell at the gate with the Till off and in the Till with it on", () => {
    const module = read("src/components/venue/features/checkin/VenueCheckInModule.tsx");
    // #4490 — the native camera screen moved out of the route file (scan.tsx is
    // also bundled on web), into VenueCheckInScanScreen.native.tsx.
    const scan = read("src/components/venue/features/checkin/VenueCheckInScanScreen.native.tsx");
    for (const src of [module, scan]) {
      expect(src).toContain("<VenueGateSale");
      expect(src).toContain("doorSaleEntry({ tillReleased");
      expect(src).toContain("/till?");
    }
  });
});

describe("H3 VAT included shows the 'Includes VAT' line", () => {
  it("reads the amount from vat.amountMinor when the server reports tax 0", () => {
    const quote = parseEntryQuote({
      quoteId: "q",
      currencyCode: "NGN",
      totalMinor: 500000,
      subtotalMinor: 500000,
      taxMinor: 0,
      vat: { mode: "included", ratePct: 7.5, amountMinor: 34884 },
      lines: [{ priceOptionId: "a", name: "Walk-in", guests: 1, unitPriceMinor: 500000, baseMinor: 500000, taxMinor: 0, totalMinor: 500000 }],
    });
    expect(quote?.taxMinor).toBe(34884);
    const rows = summaryLines(quote?.lines ?? [], {
      currencyCode: "NGN",
      exponent: 2,
      taxMinor: quote?.taxMinor ?? 0,
      feeMinor: 0,
      totalMinor: 500000,
      vatMode: "included",
      vatRatePct: 7.5,
    });
    expect(rows.map((r) => r.label)).toContain("Includes VAT 7.5%");
    expect(rows.find((r) => r.label === "Total")?.value).toContain("5,000");
  });

  it("VAT not charged never shows a VAT line", () => {
    const quote = parseEntryQuote({ quoteId: "q", currencyCode: "NGN", totalMinor: 100, vat: { mode: "none", amountMinor: 9 }, lines: [] });
    expect(quote?.taxMinor).toBe(0);
  });
});

describe("tap targets are 44 in a phone-width browser", () => {
  it("the floor is 44 on web below the wide-desktop width and 0 elsewhere", () => {
    expect(touchFloorFor("web", 390)).toBe(44);
    expect(touchFloorFor("web", 768)).toBe(44);
    expect(touchFloorFor("web", 1023)).toBe(44);
    expect(touchFloorFor("web", 1024)).toBe(0);
    expect(touchFloorFor("web", 1440)).toBe(0);
    expect(touchFloorFor("ios", 390)).toBe(0);
    expect(touchFloorFor("web", 0)).toBe(0);
  });

  it("the small controls read the floor (hitSlop does nothing on web)", () => {
    for (const file of [
      "ui/Button.tsx",
      "ui/IconChrome.tsx",
      "ui/Stepper.tsx",
      "ui/WeekdayChips.tsx",
      "ui/NumberStepper.tsx",
      "venue/VenueModulePillRow.tsx",
    ]) {
      expect(read(`src/components/${file}`)).toContain("useTouchFloor");
    }
  });
});

describe("leaving the Entry editor with unsaved work asks first", () => {
  it("the header Close goes through a leave dialog with Save, Discard and Keep editing", () => {
    const src = read("src/components/venue/features/offers/EntryEditor.tsx");
    expect(src).toContain("onPress={requestClose} testID=\"entry-editor-close\"");
    expect(src).toContain('variant="leave"');
    expect(src).toContain("if (dirtyRef.current)");
    expect(src).toContain("entry-editor-leave-keep");
  });
});

describe("a quote problem offers a real button, not an inline text link", () => {
  it("Check again is an EntryButton", () => {
    const src = read("src/components/venue/offers/EntryPicker.tsx");
    expect(src).toContain('label="Check again"');
    expect(src).not.toMatch(/<Text[^>]*onPress=\{selection\.retryQuote\}/);
  });
});

describe("a stretched segmented control never runs past its track", () => {
  it("renders a plain row (not a horizontal scroll view) when stretched, with labels that can wrap", () => {
    const src = read("src/components/ui/Pill.tsx");
    expect(src).toContain("const Row: React.ElementType = full ? View : ScrollView;");
    expect(src).toContain("numberOfLines={full ? 2 : 1}");
  });
});

describe("the wide side panel and the phone sheets all have a Close", () => {
  it("the day-limit, special-day, space and scan sheets use the shared head", () => {
    for (const f of [
      "features/offers/DayLimitsSection.tsx",
      "features/SpecialDaySheet.tsx",
      "features/SpaceEditorSheet.tsx",
      "features/checkin/VenueCheckInModule.tsx",
    ]) {
      expect(read(`src/components/venue/${f}`)).toContain("<PickerSheetHead");
    }
  });
});

describe("H3 a booking with VAT included still says what VAT is inside the price", () => {
  it("works the amount out from the rate when the booking reports tax 0", () => {
    const vat = bookingVat({ taxMinor: 0, totalMinor: 1000000, feeMinor: 0, vatMode: "included" }, 7.5);
    expect(vat).toEqual({ taxMinor: 69767, ratePct: 7.5 });
  });
  it("keeps the stored tax when VAT was added, and says nothing when there is no rate or no VAT", () => {
    expect(bookingVat({ taxMinor: 75000, totalMinor: 1075000, feeMinor: 0, vatMode: "added" }, 7.5).taxMinor).toBe(75000);
    expect(bookingVat({ taxMinor: 0, totalMinor: 1000000, feeMinor: 0, vatMode: "included" }, null).taxMinor).toBe(0);
    expect(bookingVat({ taxMinor: 0, totalMinor: 1000000, feeMinor: 0, vatMode: "none" }, 7.5).taxMinor).toBe(0);
  });
});
