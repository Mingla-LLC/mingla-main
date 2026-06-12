# ORCH-1118 render-proof — how to run `EditPublishedTripScreen.render.test.tsx`

This is the runtime mount proof (mingla-tester RETEST) for ORCH-1118. It renders
the REAL `EditPublishedTripScreen` via `@testing-library/react-native` to prove
the swapped `MapboxAddressInput` pickers MOUNT on the basics path and the save
gate FIRES at runtime (killing the dead-tap / stale-render class).

The business package's default jest is `testEnvironment: node` + `ts-jest` with
NO React Native preset and NO `@testing-library/react-native` installed, so this
test runs under a dedicated config + a worktree-local dependency overlay.

## One-time setup (overlay — NOT committed; node_modules is a symlink to the anchor)

```bash
cd mingla-business
mkdir -p .orch1118-testdeps
printf '{ "name": "orch1118-testdeps", "private": true, "version": "1.0.0" }' \
  > .orch1118-testdeps/package.json
( cd .orch1118-testdeps && npm install --no-save --no-audit --no-fund \
    react-test-renderer@19.1.0 @testing-library/react-native@14.0.0 )
```

## Run

```bash
cd mingla-business
npx jest --config jest.orch1118.render.cjs --runInBand
```

## Expected (against the CURRENT branch HEAD)

- `(a)` PASS — both location fields mount as MapboxAddressInput (combobox).
- `(b1-gate)` PASS — blocked save does not open the change-summary modal; toast fires.
- `(b1-inline-error)` **FAIL** — documents P1-EDIT-STALE-ERROR: the inline field
  errors do NOT render after a blocked save because `renderSectionBody`'s
  `useCallback` dep array omits `showEditAddressErrors`. Goes green once the dep
  is added.
- `(b2-gate)` PASS — empty departure (hard-required) blocks even with a valid destination.
- `(c)` PASS — both-validly-picked path opens the modal.

## Fails-on-revert (gate)

Neutralizing the location gate in `handleSavePress` (`if (false)`) flips
`(b1-gate)` and `(b2-gate)` to FAIL (the modal opens) — proving they exercise the
runtime gate. Verified at branch HEAD `73b3c29b4`.

RTL 14 note: `render`, `fireEvent`, and `fireEvent.changeText/press` are ASYNC —
`await` them. `react/react-native` are pinned to the business install
(single-copy); only the renderer + RTL come from the overlay.
