/**
 * ORCH-1190 — venue suite polish batch (8 items). Implementor happy-path
 * regression test.
 *
 * Runs under the DEFAULT node/ts-jest config (no RTL needed in this worktree —
 * @testing-library/react-native is gitignored + not provisioned here), exactly
 * like the ORCH-1184 (venueSuiteShell.orch1184.fullwidth.test.ts) and ORCH-1186-A
 * (orch1186HoursUnification.test.ts) implementor tests: source-text wiring
 * assertions on the REAL component sources. The tester writes the adversarial
 * mounted render proofs.
 *
 * FAILS-ON-REVERT (each verified by TRUE LINE-DELETION of the fix, NOT a
 * comment-out, per the implementor contract):
 *  - #1: restoring `maxWidth: venueSettingsMaxWidth` on the Settings host → #1 FAILS.
 *  - #2: re-adding the Availability "Add" service-period button / the period
 *        edit Pressable / the VenueServicePeriodSheet import → #2 FAILS.
 *  - #3: a bare `<Switch` reappearing in any venue-suite file (the green native
 *        track) → #3 FAILS.
 *  - #4: removing the accordion icon/bold-title affordance → #4 FAILS.
 *  - #5: re-adding the "More rules are coming…" copy → #5 FAILS.
 *  - #6: re-adding the blackout_scope informational block to the Tables panel → #6 FAILS.
 *  - #7: the blast row reappearing in Settings, or vanishing from Overview → #7 FAILS.
 *  - #8: collapsing the inner tableRow / dropping width:100% + minWidth:0 → #8 FAILS.
 *
 * Append-only: NEW file; modifies/deletes no existing test.
 *
 * Run: cd mingla-business && npx jest venueSuitePolish.orch1190
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const VENUE = join(__dirname, "..");
const UI = join(__dirname, "..", "..", "ui");

const read = (p: string): string => readFileSync(p, "utf8");

/** Strip line + block comments so doc-comment prose never trips an assertion. */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SETTINGS = stripComments(read(join(VENUE, "VenueSettingsModule.tsx")));
const OVERVIEW = stripComments(read(join(VENUE, "VenueIntelligenceModule.tsx")));
const AVAIL = stripComments(read(join(VENUE, "VenueAvailabilityModule.tsx")));
const PANEL = stripComments(read(join(VENUE, "VenueCapacityRulesPanel.tsx")));
const TABLES = stripComments(read(join(VENUE, "VenueTablesModule.tsx")));
const BRAND_SWITCH = stripComments(read(join(UI, "BrandSwitch.tsx")));

// The full set of venue-suite files that previously rendered a Switch.
const SWITCH_HOST_FILES = [
  "VenueSettingsModule.tsx",
  "VenueCapacityRulesPanel.tsx",
  "BrandHoursEditor.tsx",
  "MenuItemSheet.tsx",
  "VenueTableSheet.tsx",
];

describe("ORCH-1190 #1 — full-width parity (Settings no longer caps width)", () => {
  it("Settings host no longer applies the venueSettingsMaxWidth cap", () => {
    expect(SETTINGS).not.toMatch(/venueSettingsMaxWidth/);
    expect(SETTINGS).not.toMatch(/maxWidth:\s*venueSettingsMaxWidth/);
  });
  it("Settings no longer branches the host style on isWideDesktop", () => {
    expect(SETTINGS).not.toMatch(/useResponsiveLayout/);
    expect(SETTINGS).not.toMatch(/isWideDesktop/);
  });
});

describe("ORCH-1190 #2 — service periods read-only + redirect to Settings", () => {
  it("Availability shows the 'pulled from your opening hours' source note", () => {
    expect(AVAIL).toContain("venue-avail-periods-source-note");
    expect(AVAIL).toMatch(/Pulled from your opening hours/);
  });
  it("Availability has NO inline add/edit of hours (single-owner preserved)", () => {
    // The "Add" service-period button is gone…
    expect(AVAIL).not.toMatch(/venue-avail-add-period/);
    // …the per-row EDIT pressable is gone (openEditPeriod / period sheet)…
    expect(AVAIL).not.toMatch(/openEditPeriod|openAddPeriod|handleSavePeriod/);
    // …and the inline period editor sheet is no longer mounted/imported.
    expect(AVAIL).not.toMatch(/VenueServicePeriodSheet/);
  });
  it("Availability routes to the Settings hours editor instead", () => {
    expect(AVAIL).toContain("venue-avail-edit-hours-in-settings");
    expect(AVAIL).toMatch(/selectModule\?\.\("settings"\)/);
  });
});

describe("ORCH-1190 #3 — brand-colored toggle (no native green)", () => {
  it("a shared BrandSwitch exists and bakes in the brand track color", () => {
    expect(BRAND_SWITCH).toContain("export function BrandSwitch");
    expect(BRAND_SWITCH).toContain("accent.warm");
    // ON = brand orange, OFF = neutral (never the native green).
    expect(BRAND_SWITCH).toMatch(/true:\s*accent\.warm/);
  });
  it("NO bare <Switch> survives in any venue-suite file (all routed via BrandSwitch)", () => {
    for (const f of SWITCH_HOST_FILES) {
      const src = stripComments(read(join(VENUE, f)));
      // No `<Switch` JSX (the native green track) and no Switch import from RN.
      expect(src).not.toMatch(/<Switch\b/);
      expect(src).not.toMatch(/[,{]\s*Switch\s*[,}]/);
    }
  });
});

describe("ORCH-1190 #4 — Smart capacity rules is an affordanced accordion", () => {
  it("the panel header has the To-do-style icon + bold title cluster + chevron", () => {
    expect(PANEL).toContain("headerLeft");
    // ORCH-1196: venue glyphs migrated custom Icon → lucide-react-native.
    // grid → LayoutGrid; the open/close chevron is now a conditional
    // ChevronUp/ChevronDown render. Intent unchanged: icon + chevron cluster.
    expect(PANEL).toMatch(/<LayoutGrid size=\{16\}/);
    expect(PANEL).toMatch(/open \? \(\s*<ChevronUp/);
    expect(PANEL).toMatch(/<ChevronDown size=\{18\}/);
    // bold (700) title, not the old tertiary labelCap caption.
    expect(PANEL).toMatch(/headerTitle:\s*\{[^}]*fontWeight:\s*"700"/);
  });
  it("the toggle animates expand/collapse (LayoutAnimation)", () => {
    expect(PANEL).toContain("LayoutAnimation.configureNext");
  });
});

describe("ORCH-1190 #5 — removed the 'More rules are coming' copy", () => {
  it("the footnote copy is gone", () => {
    expect(PANEL).not.toMatch(/More rules are coming/);
    expect(PANEL).not.toMatch(/we honour today/);
  });
});

describe("ORCH-1190 #6 — blackout scope removed from the Tables panel", () => {
  it("the standalone blackout_scope informational block is gone from the panel", () => {
    // No rendered blackout_scope catalog block remains.
    expect(PANEL).not.toMatch(/CAPACITY_RULE_CATALOG\.blackout_scope/);
    expect(PANEL).not.toMatch(/Set the scope when you\s*add a blackout/);
  });
  it("the scope selector lives in the add-blackout flow (Availability sheet)", () => {
    const sheet = stripComments(read(join(VENUE, "VenueBlackoutSheet.tsx")));
    expect(sheet).toContain("Applies to");
    expect(sheet).toContain("venue-blackout-scope-");
    // all three scopes selectable there.
    expect(sheet).toMatch(/value:\s*"all"/);
    expect(sheet).toMatch(/value:\s*"zone"/);
    expect(sheet).toMatch(/value:\s*"table"/);
  });
});

describe("ORCH-1190 #7 — blast entry moved Settings → top of Overview", () => {
  it("Settings no longer renders the blast section/row", () => {
    expect(SETTINGS).not.toMatch(/Reach your guests/);
    expect(SETTINGS).not.toMatch(/venue-settings-message-guests/);
    expect(SETTINGS).not.toMatch(/handleBlast/);
  });
  it("Overview renders the blast button at the top, reuse-only deep-link", () => {
    expect(OVERVIEW).toContain("venue-overview-message-guests");
    expect(OVERVIEW).toContain("Message your guests");
    // REUSE-ONLY: the exact composer deep-link contract, built via the helper.
    expect(OVERVIEW).toMatch(/buildComposeAudienceHref\("brand",\s*brandId\)/);
    // manager-plus gated (parity with the other venue action affordances).
    expect(OVERVIEW).toMatch(/rank >= MANAGER_PLUS_RANK/);
  });
  it("Overview does NOT add a new composer/send path (reuse-only)", () => {
    // No new send mutation / composer component — only navigation.
    expect(OVERVIEW).not.toMatch(/useSendCampaign|sendBlast|createCampaign/);
  });
});

describe("ORCH-1190 #8 — mobile table card lays out correctly", () => {
  it("the row layout lives on an inner tableRow View, not the GlassCard wrapper", () => {
    expect(TABLES).toContain("styles.tableRow");
    expect(TABLES).toMatch(/tableRow:\s*\{[^}]*flexDirection:\s*"row"/);
  });
  it("the card fills its column and the flex children can shrink (minWidth:0)", () => {
    expect(TABLES).toMatch(/tableCard:\s*\{[^}]*width:\s*"100%"/);
    expect(TABLES).toMatch(/tableMain:\s*\{[^}]*minWidth:\s*0/);
    expect(TABLES).toMatch(/tableText:\s*\{[^}]*minWidth:\s*0/);
  });
  it("the tableCard wrapper no longer carries flexDirection:row", () => {
    expect(TABLES).not.toMatch(/tableCard:\s*\{[^}]*flexDirection:\s*"row"/);
  });
});
