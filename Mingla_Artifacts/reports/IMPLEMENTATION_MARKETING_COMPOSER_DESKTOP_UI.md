# IMPLEMENTATION_MARKETING_COMPOSER_DESKTOP_UI

Status: implemented and verified

Date: 2026-05-19

Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`

## Scope

This implementation fixes the Mingla Business Expo web desktop marketing composer UI only. It does not modify iOS or Android behavior intentionally.

The target route is:

- `mingla-business/app/(tabs)/marketing/campaigns/compose.tsx`

Related desktop chrome/components:

- `mingla-business/app/(tabs)/_layout.tsx`
- `mingla-business/src/components/marketing/ComposerHeader.tsx`
- `mingla-business/src/components/marketing/ComposerFooter.tsx`
- `mingla-business/src/components/marketing/ComposerStepWho.tsx`
- `mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx`
- `mingla-business/src/components/marketing/ComposerV2/InsertionBar.tsx`
- `mingla-business/src/components/__tests__/desktopWebLayoutContracts.test.ts`

## What changed

### Persistent desktop rail on composer

The tab layout no longer hides the desktop rail on `/marketing/campaigns/compose`. The route still hides the mobile bottom capsule on composer screens so the mobile footer is not covered.

Contract:

- Desktop web: `hideBottomNav` is false for composer because the condition is `pathname.includes("/campaigns/compose") && !isWideDesktop`.
- Narrow web/native: composer still hides the bottom nav capsule.

### Composer desktop shell

The composer route now applies a desktop-only panel treatment:

- compact horizontal margins
- compact top and bottom bezel
- rounded panel corners
- subtle border
- transparent/near-flat dark surface
- no full-bleed odd background on desktop

The route remains mobile-first outside `isWideDesktop`.

### Flat premium desktop controls

The desktop composer now avoids heavy tinted/backdrop button styling:

- Header back button uses transparent desktop styling.
- Save Draft keeps compact desktop height.
- Audience picker is flat with a clean border.
- Toolbar pills are flat in desktop mode, with active state expressed through border color rather than heavy fill/glow.
- Footer buttons are flat/outlined except the enabled primary CTA, which uses the warm brand fill.

### Docked footer rhythm

The Preview / Send now / Schedule row is docked to the bottom of the desktop composer panel.

Final spacing contract:

- Footer container is desktop-only `position: "absolute"`.
- Footer sits `spacing.sm` above the panel bottom.
- Footer bottom padding is `0` on desktop.
- Composer panel has `spacing.sm` bottom bezel from the viewport.

### Message editor sizing and rounding

The message editor is desktop-gated and recalibrated around the real anchors:

- Top anchor: personalization toolbar row (`B`, `I`, `Link`, `+ Event`, `Personalize`, menu).
- Bottom anchor: footer CTA row (`Preview`, `Send now`, `Schedule`).

Final spacing/sizing contract:

- Desktop body height: `Math.max(400, Math.min(rawBodyHeight - 44, 700))`.
- Desktop editor top spacing: `marginTop: spacing.md`.
- Desktop editor bottom spacing: `marginBottom: spacing.md`.
- Desktop editor rounds with `borderRadius: radius.lg`.
- Desktop editor clips WebView/square edge bleed via `overflow: "hidden"`.

Do not replace this with root-level `flex: 0`; that collapses nested Expo route content under the marketing layout.

## Regression tests added or strengthened

File:

- `mingla-business/src/components/__tests__/desktopWebLayoutContracts.test.ts`

Contracts now covered:

- Desktop composer keeps the left rail visible.
- Composer uses `useResponsiveLayout` for desktop gating.
- Composer desktop surface keeps `desktopHost`.
- Footer keeps `desktopFlatBtn` and `desktopPrimaryBtnEnabled`.
- Editor keeps `desktopBodyHost` and `desktopSubjectPersonalize`.
- Insertion bar keeps `pillDesktopFlat` and `pillDesktopFlatActive`.
- Composer vertical rhythm locks:
  - route `marginBottom: spacing.sm`
  - footer `position: "absolute"`
  - footer `bottom: spacing.sm`
  - footer desktop `paddingBottom: 0`
  - editor desktop height formula
  - editor `marginTop: spacing.md`
  - editor `marginBottom: spacing.md`
  - editor `borderRadius: radius.lg`
  - editor `overflow: "hidden"`

## Verification

Passed:

```sh
npx jest 'src/components/__tests__/desktopWebLayoutContracts.test.ts' 'src/components/ui/__tests__/BottomNavWebDesktopPolish.test.ts' 'src/components/marketing/ComposerV2/__tests__/InsertionBar.test.ts' --runTestsByPath 'app/(tabs)/marketing/campaigns/__tests__/compose.template-prefill.test.ts'
```

Result:

- 4 test suites passed
- 22 tests passed

Passed:

```sh
git diff --check -- 'mingla-business/app/(tabs)/_layout.tsx' 'mingla-business/app/(tabs)/marketing/campaigns/compose.tsx' 'mingla-business/src/components/__tests__/desktopWebLayoutContracts.test.ts' 'mingla-business/src/components/marketing/ComposerFooter.tsx' 'mingla-business/src/components/marketing/ComposerHeader.tsx' 'mingla-business/src/components/marketing/ComposerStepWho.tsx' 'mingla-business/src/components/marketing/ComposerV2/ComposerV2Editor.tsx' 'mingla-business/src/components/marketing/ComposerV2/InsertionBar.tsx'
```

Passed with no output:

```sh
npx tsc --noEmit --pretty false 2>&1 | rg 'app/\(tabs\)/_layout|app/\(tabs\)/marketing/campaigns/compose|src/components/__tests__/desktopWebLayoutContracts|src/components/marketing/Composer(Header|Footer|StepWho)|src/components/marketing/ComposerV2/(ComposerV2Editor|InsertionBar)'
```

Interpretation: no TypeScript errors were reported for the scoped touched files.

Watchman recrawl warnings appeared during Jest runs. They were non-blocking and unrelated to the implementation.

## Explicit non-goals

Do not treat this implementation as approval to change:

- iOS composer layout
- Android composer layout
- mobile bottom nav behavior
- marketing data hooks
- other marketing tab pages
- event/trip creator flows
- cover picker
- auth/session behavior
- strict-grep workflow files

## Dirty tree exclusions

The shared checkout had unrelated modified and untracked files during this work. They are intentionally excluded from this scoped commit unless explicitly staged by the operator later.

Examples observed include:

- `.github/workflows/strict-grep-mingla-business.yml`
- `app-mobile/src/components/ui/KeyboardAwareScrollView.tsx`
- several `mingla-business/app/(tabs)/marketing/*` list/detail pages unrelated to composer chrome
- several marketing hooks
- event/trip creator and cover picker files
- untracked strict-grep scripts
- untracked ORCH-0888/ORCH-0889 reports/specs/tests
- untracked file reader utility files

Future agents must check `git status --short` before staging and must not include unrelated work in this composer UI commit.

## Anti-regression warning

Do not regress these desktop composer contracts:

1. The left desktop rail must remain visible on `/marketing/campaigns/compose`.
2. The composer desktop surface must stay compact, flat, and panelized.
3. The footer CTA row must remain docked to the bottom of the composer panel.
4. The message editor must be vertically balanced between the top personalization toolbar and the bottom CTA row.
5. The message editor must keep rounded corners and clip square WebView edge bleed.
6. Desktop-only changes must stay gated through `useResponsiveLayout`.
7. Native/mobile behavior must remain unchanged unless a new spec explicitly says otherwise.

