# SPEC — ORCH-0834-rescoped: Stripe RN config baseline + free-ticket bottom-sheet migration + Hosted Checkout fallback reference

**Mode:** SPEC
**Author:** Claude `mingla-forensics`
**Date:** 2026-05-14
**Working tree:** `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`
**Investigation:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834-RESCOPED_STRIPE_CONFIG_AND_ALL_FILTER_NO_TM.md`
**Plan B reference:** `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834_FILTERS_REGRESSION_AND_RENDERING_ARCHITECTURE.md` § "Architecture Options Decision Matrix" Option A

---

## 1. Layman Summary

**Plan A (this SPEC) — operator-confirmed direction 2026-05-14:** Three changes shipped together in one PR:
1. **Upgrade Stripe RN 0.50.3 → 0.65.1** (15 minor versions of bug fixes + iOS 26 fixes + Stripe-iOS SDK bumped from 24.19 to ~24.30). Single-line package.json change + `npm install`. The diagnostic value: if the hang was a 0.50.3-era bug fixed in later versions, this resolves it on its own.
2. **Add the missing Stripe RN baseline config** (Expo plugin entry + merchantIdentifier + urlScheme props on StripeProvider). Brings `app-mobile` to parity with Stripe's documented requirements. Enables Apple Pay support as a bonus. Required regardless of which Stripe path wins long-term.
3. **Migrate `TicketClaimConfirmModal`** from React Native `Modal` to inline `@gorhom/bottom-sheet` matching the event-detail sheet pattern. Visual consistency. Free + paid both feel native.

**Honest expectation:** Two of these are pure improvements (#2 + #3 ship value regardless). #1 is the experiment that might fix the PaymentSheet hang — high chance of working (0.65.1 is 15 versions of fixes ahead), but no guarantee. **If the post-build retest still hangs paid checkout: investigate via remaining native options (X1 bridgeless toggle, X2 CardField rewrite, then Plan B Hosted Checkout as last resort).**

**One EAS build tests all three changes simultaneously** — the SDK upgrade requires a native rebuild AND the Stripe Expo plugin addition requires a native rebuild, so bundling them costs nothing extra.

---

## 2. Scope, Non-Goals, Assumptions

### 2.1 In-scope

| ID | Change | Layer | Cost |
|---|---|---|---|
| **S0** | **`app-mobile/package.json` upgrade `@stripe/stripe-react-native` from `^0.50.3` to `^0.65.1` + `npm install`** | **Dependency** | **1 line + lockfile regen** |
| S1 | `packages/payments-native/StripeNativeProvider.tsx` accepts and forwards `merchantIdentifier` + `urlScheme` props (with env fallbacks) | Package | ~10 LoC |
| S2 | `app-mobile/app/_layout.tsx` passes both new props to `<StripeNativeProvider>` | Component | ~5 LoC |
| S3 | `app-mobile/app.json` plugins block adds `["@stripe/stripe-react-native", {merchantIdentifier, enableGooglePay}]` | Config | 1 entry |
| S4 | `TicketClaimConfirmModal.tsx` migrates from RN `Modal` to inline `@gorhom/bottom-sheet` | Component | ~80 LoC |
| S5 | `ExpandedBusinessEventSheet.tsx` adjusts to render the migrated confirmation as a sibling inline `<BottomSheet>` instance | Component | ~10 LoC |
| S6 | Regression check: assert StripeNativeProvider passes the new props + assert app.json has the plugin + **assert package.json Stripe RN version ≥ 0.65.0** | CI | ~50 LoC new script |

### 2.2 Plan B (NOT in this SPEC — only referenced)

If post-Plan-A real-device retest still hangs on `presentPaymentSheet`, dispatch a separate SPEC for the **Hosted Checkout via `expo-web-browser` pivot** — full detail at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834_FILTERS_REGRESSION_AND_RENDERING_ARCHITECTURE.md` § "Architecture Options Decision Matrix" Option A. Do NOT pre-build the pivot in this SPEC.

### 2.3 Non-goals

- ORCH-0833 "All filter no TM events" — needs operator real-device Metro log first (per investigation Part B); deferred until that log arrives.
- ORCH-0829-B D-1 defensive patches (RPC tombstone-expiry, H-2 try/finally, H-3 timeout race) — ship unchanged; no rework needed.
- Stripe Hosted Checkout pivot — Plan B only.
- Free-ticket flow business logic — only the UI surface (Modal → BottomSheet) changes; the edge function `free_completed` path stays intact.

### 2.4 Assumptions

| ID | Assumption | Validation |
|---|---|---|
| A1 | Operator has or can create an Apple Merchant ID in Stripe Dashboard (`merchant.com.mingla.app.v2`) | Pre-flight checklist item in §9 |
| A2 | EAS Build will pick up the new `app.json` plugin entry on the next iOS profile=development build | Standard Expo behavior |
| A3 | The `@mingla/payments-native` package can be safely modified to add 2 optional props; consumers (mingla-business + app-mobile) won't break | mingla-business's StripeNativeProvider is a NO-OP shim and doesn't use the shared package; only app-mobile consumes the package version |
| A4 | Stripe RN 0.65.1 will compile cleanly on Xcode 26 in EAS Build (the prior chase showed 0.51.0 broke compile with `fmt consteval errors`; 0.65.1 is 14 versions newer and Stripe RN updates their iOS SDK in lockstep — likely fixed) | Validated by EAS build — if compile fails, implementor reports the exact error and we either patch or revert to 0.50.3 + commit only the other changes (S1-S6) |
| A5 | Stripe RN 0.65.1's `initPaymentSheet`, `presentPaymentSheet`, and `useStripe` APIs remain backward-compatible with our usage in `nativeCheckoutFlow.ts:124-167` + `useStripePaymentSheet.ts` | Reviewed 0.50→0.65 changelog: only breaking change documented is `RowStyle.FlatWithChevron` → `RowStyle.FlatWithDisclosure` which is Embedded Payment Element only (we don't use it). All PaymentSheet APIs we touch are unchanged |
| A6 | Mingla-business stays on 0.50.3 for now; the version drift between apps is acceptable because they share only the `@mingla/payments-native` wrapper code (which works against the Stripe RN public API surface that's stable across these versions) | Documented as Discovery for follow-up ORCH |

---

## 3. Layer-by-Layer Specification

### 3.0 Dependency layer (S0) — Stripe RN SDK upgrade

**File:** `app-mobile/package.json`

**Current line 37:**
```json
"@stripe/stripe-react-native": "^0.50.3",
```

**New:**
```json
"@stripe/stripe-react-native": "^0.65.1",
```

**After the edit, implementor MUST:**
```bash
cd app-mobile && npm install
```

This regenerates `app-mobile/package-lock.json` with the resolved 0.65.1 version. The lockfile change must be committed alongside the package.json edit so EAS Build picks up the right version.

**Contract checks:**
- Verify `app-mobile/package-lock.json` resolves to `0.65.1` (or latest 0.65.x patch) after `npm install`
- Verify `app-mobile/node_modules/@stripe/stripe-react-native/package.json` `"version"` field reads `0.65.1`
- Verify the Stripe iOS pod version bumped (via `app-mobile/ios/Podfile.lock` after subsequent `pod install` during EAS build) — expected jump from `Stripe ~24.19` to `Stripe ~24.30+`
- Do NOT manually edit `app-mobile/ios/Podfile.lock` — let EAS Build's `pod install` handle it during the cloud build

**Risk acknowledgment:** prior research showed 0.51.0 fails Xcode 26 compile with `fmt consteval errors` per `IMPLEMENTATION_ORCH-0829-B_STRIPE_DOUBLE_RESOLVE.md` §4. 0.65.1 is 14 minor versions newer; Stripe RN updates stripe-ios in lockstep and presumably has fixed iOS 26 compile by now. **If EAS Build fails compile on 0.65.1**: implementor reports the exact error in the implementation report, reverts S0 only (keeps S1-S6 changes), and orchestrator dispatches a bench cycle on intermediate versions (0.55, 0.60, 0.62, etc.) to find a working version. Do NOT push the revert commit; report the build failure and wait for orchestrator direction.

### 3.1 Package layer (S1)

**File:** `packages/payments-native/StripeNativeProvider.tsx`

**Current (37 lines, source already in context):**
```tsx
export const StripeNativeProvider: React.FC<StripeNativeProviderProps> = ({
  children,
  publishableKey,
}) => {
  const key = publishableKey ?? resolvePublishableKey();
  return (
    <StripeProvider publishableKey={key}>
      <>{children}</>
    </StripeProvider>
  );
};
```

**New:**
```tsx
interface StripeNativeProviderProps {
  children: React.ReactNode;
  publishableKey?: string;
  /** Apple Pay merchant identifier (e.g. "merchant.com.mingla.app.v2"). Falls back to EXPO_PUBLIC_STRIPE_MERCHANT_ID env var. Required for Apple Pay support; harmless for plain card payments. */
  merchantIdentifier?: string;
  /** App URL scheme for Stripe redirect callbacks (e.g. "com.mingla.app.v2"). Falls back to EXPO_PUBLIC_STRIPE_URL_SCHEME env var. Required for 3D Secure and Apple/Google Pay return flows; harmless for non-3DS card payments. */
  urlScheme?: string;
}

const resolveEnvString = (
  expoExtraKey: string,
  processEnvKey: string,
): string | undefined => {
  const fromExtra = (
    Constants.expoConfig?.extra as Record<string, string | undefined> | undefined
  )?.[expoExtraKey];
  const fromEnv = process.env[processEnvKey];
  return fromExtra ?? fromEnv ?? undefined;
};

const resolvePublishableKey = (): string => {
  return resolveEnvString(
    "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY",
  ) ?? "";
};

const resolveMerchantIdentifier = (): string | undefined =>
  resolveEnvString("EXPO_PUBLIC_STRIPE_MERCHANT_ID", "EXPO_PUBLIC_STRIPE_MERCHANT_ID");

const resolveUrlScheme = (): string | undefined =>
  resolveEnvString("EXPO_PUBLIC_STRIPE_URL_SCHEME", "EXPO_PUBLIC_STRIPE_URL_SCHEME");

export const StripeNativeProvider: React.FC<StripeNativeProviderProps> = ({
  children,
  publishableKey,
  merchantIdentifier,
  urlScheme,
}) => {
  const key = publishableKey ?? resolvePublishableKey();
  const mid = merchantIdentifier ?? resolveMerchantIdentifier();
  const scheme = urlScheme ?? resolveUrlScheme();
  return (
    <StripeProvider
      publishableKey={key}
      merchantIdentifier={mid}
      urlScheme={scheme}
    >
      <>{children}</>
    </StripeProvider>
  );
};
```

**Contract checks:**
- All three props are optional in TypeScript (existing `publishableKey?` pattern)
- Stripe RN's `<StripeProvider>` already accepts `merchantIdentifier?` and `urlScheme?` as optional props per its type definitions (`@stripe/stripe-react-native` ≥ 0.50)
- Env fallback order matches existing pattern (Constants.expoConfig.extra → process.env)

### 3.2 Component layer (S2)

**File:** `app-mobile/app/_layout.tsx`

**Current (lines 53-55):**
```tsx
<StripeNativeProvider>
```

**New:**
```tsx
<StripeNativeProvider
  merchantIdentifier="merchant.com.mingla.app.v2"
  urlScheme="com.mingla.app.v2"
>
```

**Contract checks:**
- `merchantIdentifier` matches what mingla-business uses pattern-wise: `merchant.com.<bundle-id>` (operator confirms in pre-flight whether to use `merchant.com.mingla.app.v2` or a different existing Apple Merchant ID)
- `urlScheme` matches the existing app.json `scheme` field and `Info.plist` CFBundleURLTypes
- These can also be omitted entirely if operator prefers env-var configuration (the env fallbacks in §3.1 handle it)

### 3.3 Config layer (S3)

**File:** `app-mobile/app.json`

**Current plugins block (excerpt):**
```json
"plugins": [
  ["@sentry/react-native/expo", {...}],
  "expo-splash-screen",
  ...
  "expo-web-browser",
  ["onesignal-expo-plugin", {...}],
  "react-native-appsflyer"
]
```

**New (add one entry — placement doesn't matter functionally, but recommend before `@sentry/react-native/expo` for logical grouping):**
```json
"plugins": [
  [
    "@stripe/stripe-react-native",
    {
      "merchantIdentifier": "merchant.com.mingla.app.v2",
      "enableGooglePay": true
    }
  ],
  ["@sentry/react-native/expo", {...}],
  ...
]
```

**Contract checks:**
- `merchantIdentifier` MUST match what's passed to `StripeNativeProvider` in §3.2 (or whatever the operator-confirmed Apple Merchant ID is)
- `enableGooglePay: true` adds Android Google Pay metadata (matches mingla-business)
- After this change, `eas build --platform ios --profile development` is REQUIRED (not `eas update`) because the entitlements plist is being modified

### 3.4 Component layer (S4 + S5) — Free-ticket migration

**File:** `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx`

**Current shape:** Uses React Native `Modal` with `visible`, `transparent`, `animationType="slide"`, manual backdrop view, manual absolute-positioned content container.

**New shape:** Inline `<BottomSheet>` from `@gorhom/bottom-sheet` matching the pattern at `ExpandedBusinessEventSheet.tsx:120, 393-414`. Specifically:

```tsx
import BottomSheet, {
  BottomSheetView,
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
} from "@gorhom/bottom-sheet";

// Props unchanged
interface TicketClaimConfirmModalProps {
  open: boolean;
  ticketName: string;
  priceCents: number | null;
  currency: string;
  isFree: boolean;
  buyerName: string;
  buyerEmail: string;
  buyerPhone: string;
  isSubmitting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const SNAP_POINTS = ["60%"];

export const TicketClaimConfirmModal: React.FC<TicketClaimConfirmModalProps> = ({
  open,
  ticketName,
  priceCents,
  currency,
  isFree,
  buyerName,
  buyerEmail,
  buyerPhone,
  isSubmitting,
  onConfirm,
  onCancel,
}) => {
  const sheetRef = useRef<BottomSheet>(null);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
      />
    ),
    [],
  );

  const handleSheetChange = useCallback(
    (index: number): void => {
      if (index === -1) onCancel();
    },
    [onCancel],
  );

  // Helpers — keep existing price formatting + confirm-label logic
  const formattedPrice = isFree
    ? "Free"
    : `${currency === "USD" ? "$" : currency} ${((priceCents ?? 0) / 100).toFixed(2)}`;
  const confirmLabel = isFree ? "Get free ticket" : "Continue to Payment";
  const disclosure = isFree
    ? "Free tickets are issued instantly."
    : `By confirming, you'll be charged ${formattedPrice}. You can review and complete payment in the next step.`;

  return (
    <BottomSheet
      ref={sheetRef}
      index={open ? 0 : -1}
      snapPoints={SNAP_POINTS}
      enablePanDownToClose
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={styles.sheetBackground}
      handleIndicatorStyle={styles.handleIndicator}
    >
      <BottomSheetView style={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.title} numberOfLines={1}>
            {ticketName}
          </Text>
          <Pressable
            onPress={onCancel}
            accessibilityLabel="Close"
            accessibilityRole="button"
            hitSlop={8}
            style={styles.closeButton}
          >
            <Icon name="close" size={20} color="rgba(255,255,255,0.85)" />
          </Pressable>
        </View>

        <View style={styles.priceRow}>
          <Text style={styles.priceLabel}>Price</Text>
          <Text style={styles.priceValue}>{formattedPrice}</Text>
        </View>

        <Text style={styles.sectionHeader}>YOUR TICKET GOES TO</Text>
        <BuyerRow label="Name" value={buyerName} />
        <BuyerRow label="Email" value={buyerEmail} />
        <BuyerRow label="Phone" value={buyerPhone} />

        <Text style={styles.disclosure} allowFontScaling>
          {disclosure}
        </Text>

        <View style={styles.ctaRow}>
          <Pressable
            style={[styles.ctaCancel, isSubmitting && styles.ctaDisabled]}
            accessibilityLabel="Cancel"
            accessibilityRole="button"
            onPress={onCancel}
            disabled={isSubmitting}
          >
            <Text style={styles.ctaCancelLabel}>Cancel</Text>
          </Pressable>
          <Pressable
            style={[styles.ctaConfirm, isSubmitting && styles.ctaDisabled]}
            accessibilityLabel={confirmLabel}
            accessibilityRole="button"
            onPress={onConfirm}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.ctaConfirmLabel}>{confirmLabel}</Text>
            )}
          </Pressable>
        </View>
      </BottomSheetView>
    </BottomSheet>
  );
};

const styles = StyleSheet.create({
  sheetBackground: {
    backgroundColor: glass.bottomSheet.background, // match event-detail sheet
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
  },
  handleIndicator: {
    backgroundColor: "rgba(255,255,255,0.35)",
    width: 44,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 32,
  },
  // ... (keep all other existing styles from the prior Modal version)
});
```

**File:** `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx`

**Current:** Renders `<TicketClaimConfirmModal>` as a sibling fragment alongside the inline `<BottomSheet>` per ORCH-0828 pattern.

**New:** No change to the consumer side — `TicketClaimConfirmModal` is now itself a `<BottomSheet>` but still controlled by the same `open` / `onCancel` / `onConfirm` props from the parent. The sibling-fragment pattern still works because two stacked inline `<BottomSheet>` instances coexist via `@gorhom/bottom-sheet` v5 (proven by the prior ORCH-0828 TicketMaster sheet pattern).

If runtime issues surface in testing (e.g. one sheet blocks the other's gestures), fall back to rendering the confirmation sheet INSIDE the event-detail sheet's children rather than as a sibling fragment.

**Contract checks:**
- All confirmation modal behavior preserved (open / close / confirm / cancel / submitting state)
- Visual style matches event-detail sheet (rounded top corners, handle indicator, glass background)
- Free + paid both render the same way (only label + disclosure differ)
- Cancel button + backdrop tap + swipe-down all close the sheet identically (per `enablePanDownToClose` + `pressBehavior="close"`)

### 3.5 CI layer (S6)

**File:** `app-mobile/scripts/ci/orch-0834-rescoped-regression-check.mjs` (new)

**10 contracts:**
- T-A0: `app-mobile/package.json` declares `@stripe/stripe-react-native` at version `^0.65.x` or higher (NOT `^0.50.x` — proves the upgrade landed)
- T-A1: `app-mobile/app.json` contains the Stripe Expo plugin entry with `merchantIdentifier` and `enableGooglePay: true`
- T-A2: `packages/payments-native/StripeNativeProvider.tsx` declares `merchantIdentifier` + `urlScheme` props
- T-A3: `packages/payments-native/StripeNativeProvider.tsx` `<StripeProvider>` receives both props
- T-A4: `app-mobile/app/_layout.tsx` passes both props (OR env vars are set — string-match flexibility)
- T-A5: `TicketClaimConfirmModal.tsx` imports `BottomSheet` from `@gorhom/bottom-sheet`
- T-A6: `TicketClaimConfirmModal.tsx` does NOT import RN `Modal` anymore (proves migration completion)
- T-A7: `TicketClaimConfirmModal.tsx` uses `BottomSheetBackdrop` with `pressBehavior="close"` (matches event-detail sheet)
- T-A8: `TicketClaimConfirmModal.tsx` exports a controlled component (open/onCancel/onConfirm preserved)
- T-A9: `ExpandedBusinessEventSheet.tsx` still renders `<TicketClaimConfirmModal>` (sibling fragment intact)

Wire `npm run test:orch-0834-rescoped` in `app-mobile/package.json`.

---

## 4. Success Criteria

| # | Criterion | Observable | Testable |
|---|---|---|---|
| C1 | After `eas build --platform ios --profile development` + install, app launches cleanly with no Stripe-related runtime errors | Yes — launch logs | Yes — visual + Metro |
| C2 | `<StripeProvider>` in runtime receives `merchantIdentifier="merchant.com.mingla.app.v2"` and `urlScheme="com.mingla.app.v2"` | Yes — via React DevTools or runtime probe | Yes |
| C3 | Apple Pay button appears in PaymentSheet (if Stripe Dashboard has Apple Pay enabled for the linked account) | Yes — visual | Yes (visual confirmation only) |
| C4 | **CRITICAL — paid checkout with test card 4242 on real device** | Yes | **This is the operator's primary test — likely to STILL HANG per investigation; that's the trigger for Plan B dispatch** |
| C5 | Free ticket claim shows confirmation as a `@gorhom/bottom-sheet` (rounded top corners, drag handle, matches event-detail sheet visual style) | Yes — visual | Yes |
| C6 | Free ticket Cancel button + backdrop tap + swipe-down all dismiss the sheet | Yes | Yes — Maestro flows |
| C7 | Free ticket Confirm completes and creates ticket (no regression on existing free flow) | Yes — DB probe | Yes |
| C8 | Regression check `npm run test:orch-0834-rescoped` returns 9/9 PASS | Yes | Yes |
| C9 | `tsc --noEmit` clean on touched files | Yes | Yes |
| C10 | Pre-existing regression checks (0828, 0829a, 0829b, 0829b-d1) still pass | Yes | Yes |

---

## 5. Invariants

**Preserved:**
- `I-PROPOSED-BOTTOMSHEET-INLINE-FOR-EXPANDED-SHEETS` — TicketClaimConfirmModal now uses inline `<BottomSheet>` per the established pattern
- `I-PROPOSED-STRIPE-PRESENT-ONCE-ONLY` — useStripePaymentSheet wrapper unchanged
- `I-PROPOSED-O-stripe-no-webview-wrap` — no WebView wrapping introduced

**New (proposed for CLOSE):**
- `I-PROPOSED-STRIPE-PROVIDER-FULL-CONFIG` — StripeProvider MUST receive `merchantIdentifier` + `urlScheme` in addition to `publishableKey`, with env-var fallbacks. CI gate via S6.
- `I-PROPOSED-CONFIRMATION-SHEET-VIA-GORHOM` — confirmation surfaces (paid + free) MUST use `@gorhom/bottom-sheet` inline pattern, not React Native `Modal`. CI gate via S6.

---

## 6. Test Cases

| Test | Scenario | Input | Expected | Layer |
|---|---|---|---|---|
| T-C1 | App launches after EAS build with new config | Fresh install on iPhone | App boots, no red errors, no console warnings about Stripe init | Full stack |
| T-C2 | `<StripeProvider>` receives merchantIdentifier + urlScheme at runtime | Inspect RN bridge | Both props non-null when app is configured | Runtime |
| T-C3 | Free ticket sheet renders as bottom-sheet | Tap "Get free ticket" on Big Party | TicketClaimConfirmModal slides up with rounded corners + drag handle (NOT a translucent overlay rectangle) | Component |
| T-C4 | Free ticket cancel | Tap Cancel | Sheet dismisses, no ticket created | Component + DB |
| T-C5 | Free ticket confirm | Tap "Get free ticket" → Confirm | Success toast, sheet dismisses, ticket appears in calendar | Full stack |
| T-C6 | Paid ticket sheet renders as bottom-sheet | Tap "Buy ticket" on $250 ticket | Confirmation sheet visible with same UX as free | Component |
| T-C7 | **Paid ticket end-to-end via real device** | Confirm → Continue to Payment | Stripe sheet → card form → 4242 → success. **EXPECTED TO HANG per investigation — this is the Plan B trigger** | Full stack |
| T-C8 | Regression script | `npm run test:orch-0834-rescoped` | 9/9 PASS | CI |
| T-C9 | tsc clean | `npx tsc --noEmit` on touched files | No new errors | Code quality |
| T-C10 | All sibling regression tests still pass | Each `npm run test:orch-*` | All PASS | Regression |
| T-C11 | Apple Pay appears in PaymentSheet (optional, only if Apple Merchant ID is registered) | Open paid sheet | Apple Pay row visible above card entry | Visual |

---

## 7. Implementation Order

1. **Dependency** — update `app-mobile/package.json` Stripe RN version per §3.0 + run `npm install` to regenerate lockfile
2. **Package** — update `packages/payments-native/StripeNativeProvider.tsx` per §3.1
3. **Component** — update `app-mobile/app/_layout.tsx` per §3.2
4. **Config** — update `app-mobile/app.json` per §3.3 (insert Stripe plugin entry into plugins array)
5. **Component** — migrate `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx` per §3.4
6. **Component** — sanity check `ExpandedBusinessEventSheet.tsx` consumer still works per §3.4
7. **CI** — write regression script per §3.5 (10 contracts)
8. **Local verification** — `npm run test:orch-0834-rescoped` 10/10 PASS, `npm run test:orch-0828/0829a/0829b/0829b-d1` all still PASS, `tsc --noEmit` clean on touched files (note: TS errors from Stripe RN's new APIs may surface — flag any in implementation report)
9. **Implementation report** — `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0834-RESCOPED_*.md` with standard 15-section template + Plan B trigger note + EAS build outcome flag

**HANDOFF (after implementor):** orchestrator dispatches operator to run EAS build (next §)

---

## 8. Regression Prevention

- New invariants added at CLOSE (§5)
- CI gates (S6) prevent regression of both Stripe config and bottom-sheet migration
- Protective comments in `StripeNativeProvider.tsx` explaining WHY merchantIdentifier + urlScheme are needed (Apple Pay + 3DS) and that they're optional
- Protective comment at TicketClaimConfirmModal explaining why inline `<BottomSheet>` (consistency with event-detail sheet, ORCH-0828 pattern)

---

## 9. Deploy Notes — operator pre-ship checklist

| Step | Owner | Notes |
|---|---|---|
| Confirm `merchant.com.mingla.app.v2` Apple Merchant ID exists in Stripe Dashboard (Dashboard → Settings → Payment methods → Apple Pay → Add new merchant ID) | **Operator** | If not present, create it (2 min, free). If operator already has a different Apple Merchant ID registered, use that value in §3.2 + §3.3 instead. |
| Confirm Stripe Dashboard branding (logo, colors) is set to Mingla's brand if Hosted Checkout (Plan B) is ever activated | Operator | Not blocking for Plan A but worth doing pre-emptively |
| Push commit to `Seth` after implementor returns | Orchestrator | Standard flow |
| Run EAS build (NOT `eas update`) | **Operator** | `cd app-mobile && eas build --platform ios --profile development` (~20 min cloud). Required because the Stripe Expo plugin modifies the iOS entitlements plist. Subsequent JS-only changes can still use `eas update`. |
| Install new build on real iPhone | Operator | Via Expo / TestFlight install |
| Re-test paid Big Party flow with test card 4242 | **Operator** | If card form renders: Plan A worked unexpectedly — close the six-ORCH bundle. **If still hangs: that's expected per investigation — dispatch Plan B SPEC** |
| Re-test free Big Party ticket flow | Operator | Free should work cleanly with new bottom-sheet UX |

### 9.1 Plan B trigger (only if S0 SDK upgrade + S1-S3 config didn't fix the hang)

If real-device retest after EAS build still hangs `presentPaymentSheet` despite Stripe RN 0.65.1:
1. **X1 next (~30 min):** orchestrator dispatches a tiny SPEC adding `bridgelessEnabled: false` to `expo-build-properties` config in `app-mobile/app.json`. Operator runs another EAS build + real-device retest.
2. **X2 next if X1 fails (~1-2 days):** orchestrator dispatches a SPEC rewriting the paid-flow to use `<CardField>` + `confirmPayment` instead of `presentPaymentSheet`, rendered inside our existing `@gorhom/bottom-sheet`. Keeps native UX, bypasses PaymentSheet entirely. Pre-requisite: forensics bridgeless audit (already specced) confirms safety.
3. **Plan B last resort (~1 day):** orchestrator dispatches the Hosted Checkout via `expo-web-browser` pivot per the prior investigation `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834_FILTERS_REGRESSION_AND_RENDERING_ARCHITECTURE.md` § Architecture Options Decision Matrix Option A.

The ORCH-0829-B D-1 defensive patches (RPC tombstone-expiry, H-2 try/finally, H-3 timeout race) ship unchanged through all of this — they remain valuable defense-in-depth regardless of which path wins.

---

## 10. Working-Branch Discipline

All scoped work for this SPEC lives on `Seth` in `/Users/sethogieva/Desktop/mingla-main`. Implementor commits scoped files only:
- **`app-mobile/package.json` (MODIFIED — Stripe RN version bump + npm script entry)**
- **`app-mobile/package-lock.json` (MODIFIED — regenerated by `npm install`)**
- `packages/payments-native/StripeNativeProvider.tsx` (MODIFIED)
- `app-mobile/app/_layout.tsx` (MODIFIED)
- `app-mobile/app.json` (MODIFIED)
- `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx` (MODIFIED — major migration)
- `app-mobile/src/components/expandedCard/ExpandedBusinessEventSheet.tsx` (sanity check, possibly minor edit)
- `app-mobile/scripts/ci/orch-0834-rescoped-regression-check.mjs` (NEW)
- `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0834-RESCOPED_*.md` (NEW)

No global indexes (DECISION_LOG, INVARIANT_REGISTRY, WORLD_MAP, AGENT_HANDOFFS) written from this SPEC — those belong to the orchestrator at CLOSE.

---

NEXT HANDOFF — paste into Codex `implementor-mingla`:

Implement the spec at `Mingla_Artifacts/specs/SPEC_ORCH-0834-RESCOPED_STRIPE_CONFIG_AND_FREE_TICKET_BOTTOM_SHEET.md` following the investigation at `Mingla_Artifacts/reports/INVESTIGATION_ORCH-0833-0834-RESCOPED_STRIPE_CONFIG_AND_ALL_FILTER_NO_TM.md`. Working tree: `/Users/sethogieva/Desktop/mingla-main` on branch `Seth`. **SIX scoped changes** (operator-confirmed Stripe RN SDK upgrade path 2026-05-14): **(S0) `app-mobile/package.json` upgrade `"@stripe/stripe-react-native"` from `"^0.50.3"` to `"^0.65.1"` then run `cd app-mobile && npm install` to regenerate `package-lock.json`; commit both files together per spec §3.0** — this is the diagnostic experiment that may resolve the iOS 26 PaymentSheet hang on its own; (S1) `packages/payments-native/StripeNativeProvider.tsx` adds optional `merchantIdentifier` + `urlScheme` props with env-var fallbacks (`EXPO_PUBLIC_STRIPE_MERCHANT_ID` and `EXPO_PUBLIC_STRIPE_URL_SCHEME`) and passes both to `<StripeProvider>` per spec §3.1; (S2) `app-mobile/app/_layout.tsx:53` passes both props to `<StripeNativeProvider>` with `merchantIdentifier="merchant.com.mingla.app.v2"` and `urlScheme="com.mingla.app.v2"` per spec §3.2 (use the operator-confirmed Apple Merchant ID if different — flag in the implementation report); (S3) `app-mobile/app.json` plugins block adds `["@stripe/stripe-react-native", {"merchantIdentifier": "merchant.com.mingla.app.v2", "enableGooglePay": true}]` per spec §3.3; (S4) `app-mobile/src/components/expandedCard/TicketClaimConfirmModal.tsx` migrates from RN `Modal` to inline `@gorhom/bottom-sheet` per spec §3.4 (use `BottomSheetView`, `BottomSheetBackdrop` with `pressBehavior="close"`, `enablePanDownToClose`, snap point `"60%"`); (S5) sanity check `ExpandedBusinessEventSheet.tsx` consumer still works; (S6) new regression script `app-mobile/scripts/ci/orch-0834-rescoped-regression-check.mjs` per spec §3.5 with **10 contracts** (T-A0 added to assert package.json Stripe RN version is `^0.65.x` or higher) + `npm run test:orch-0834-rescoped` script. Hard guards: stay strictly within the named files; do NOT touch the Stripe Hosted Checkout pivot work (Plan B — separate dispatch only if S0-S6 retest still hangs); do NOT run `eas build` (operator gate); do NOT run `supabase db push` (no migration in this spec); do NOT touch mingla-business's stub StripeNativeProvider (mingla-business stays on Stripe RN 0.50.3 — version drift is intentional per spec A6); do NOT modify `nativeCheckoutFlow.ts` (no flow change); do NOT change `useStripePaymentSheet.ts` (the ORCH-0829-B D-1 patches ship unchanged); preserve all existing TicketClaimConfirmModal behavior (open/cancel/confirm/submitting states, free vs paid label differentiation, buyer info display, disclosure text) — only the rendering wrapper changes; **if `npm install` on Stripe RN 0.65.1 produces breaking-change errors in our existing TypeScript usage (unlikely per spec §A5 but verify), report the exact error in the implementation report and STOP** rather than silently patching — orchestrator may need to choose between intermediate version bench-cycle vs continuing forward. Run `npm run test:orch-0834-rescoped` (target: 10/10) and `npm run test:orch-0828 && npm run test:orch-0829a && npm run test:orch-0829b && npm run test:orch-0829b-d1` (all must still pass) plus `npx tsc --noEmit` (no new errors on touched files). Expected output: `Mingla_Artifacts/reports/IMPLEMENTATION_ORCH-0834-RESCOPED_STRIPE_CONFIG_AND_FREE_TICKET_BOTTOM_SHEET.md` with the standard 15-section template, old→new receipts per file (especially noting the package.json+lockfile delta), spec-traceability matrix mapping each S0-S6 + C1-C11, an "EAS build outcome" placeholder for the operator to fill in after the build runs (PASS=card form renders / FAIL=specific compile error or runtime hang), and a "Plan B sequence trigger" note flagging that if the real-device paid-checkout retest still hangs, the next options are X1 (bridgeless toggle), then X2 (CardField rewrite), then Plan B (Hosted Checkout pivot). Downstream routing: IMPLEMENT return → orchestrator REVIEW + operator runs `eas build --platform ios --profile development` (~20 min cloud — bundles native rebuild from S0 SDK swap AND S3 Expo plugin together in one build) → install on real iPhone → tester / operator RETEST paid + free flows on real device → if retest PASSES paid flow (card form renders, payment completes with 4242): **orchestrator CLOSE of the six-ORCH bundle (0824 + 0828 + 0829-A + 0829-B + 0833 + 0834-rescoped)**; if retest FAILS paid flow but free flow + bottom-sheet UX work: orchestrator dispatches X1 (bridgeless toggle, ~30 min) → if X1 fails, dispatches X2 (CardField rewrite, 1-2 days) → if X2 fails, dispatches Plan B (Hosted Checkout, 1 day); the ORCH-0829-B D-1 defensive patches ship unchanged regardless of which Stripe path eventually wins.
