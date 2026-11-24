/**
 * #4473 — the dark "Missing a ticket?" sheet.
 *
 * One sheet, several steps, so the person never leaves the moment they are in:
 *
 *   add      Email | Mobile tabs, then Send code
 *   code     6 boxes, Paste, resend countdown, checks itself at 6 digits
 *   checking the contact is confirmed; the sweep looks for purchases
 *   found    the purchases found, each with Open (shared note when a contact
 *            is also confirmed on another account)
 *   none     the contact stays saved; the other two ways are offered
 *   link     how the confirmation link works (it still ends in a code)
 *   ask      ask the buyer to use Send to a friend, via the share sheet
 *
 * The server stays the only authority: this sheet sends what the person typed
 * to `claim-contact` and renders what comes back.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  Clipboard,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import * as Haptics from "expo-haptics";
import Svg, { Circle, Path } from "react-native-svg";
import { parsePhoneEntry } from "@mingla/phone-input/phoneNumber";

import {
  BaseBottomSheet,
  BottomSheetScrollView,
  BottomSheetTextInput,
} from "../ui/BaseBottomSheet";
import { OTPInput } from "../onboarding/OTPInput";
import { PhoneInput } from "../onboarding/PhoneInput";
import {
  getCountryByCode,
  getDefaultCountryCode,
} from "../../constants/countries";
import { queryClient } from "../../config/queryClient";
import { purchaseKeys } from "../../hooks/queryKeys";
import {
  ClaimContactError,
  displayClaimIdentifier,
  sendClaimContactCode,
  sendClaimLinkContactCode,
  verifyClaimContactCode,
  verifyClaimLinkContactCode,
  type ClaimContactChannel,
  type ClaimIdentifier,
} from "../../services/claimContactService";
import type {
  ClaimedEntry,
  PendingClaim,
} from "../../services/attendanceClaimService";
import { runClaimSweep } from "../../services/claimSweep";
import {
  claimedEntryMetaLine,
  claimedEntryPath,
  claimLinkLandedTitleKey,
  hasSharedEntry,
  mergeFoundEntries,
  resendClock,
} from "./missingTicketModel";
import { AskSenderStep, ConfirmationLinkStep } from "./MissingTicketHelpSteps";
import {
  CLAIM_PHONE_COUNTRIES,
  claimPhonePlaceholder,
  defaultClaimPhoneCountry,
  isClaimPhoneCountry,
} from "./missingTicketModel";
import {
  PURCHASE_SHEET_KEYBOARD_TOOLBAR,
  SheetKeyboardDoneBar,
  sheetDoneBarId,
} from "./SheetKeyboardDoneBar";

const EMAIL_DONE_BAR_ID = sheetDoneBarId("claim-email");
const CODE_DONE_BAR_ID = sheetDoneBarId("claim-code");
import { formatStartsAtLabel } from "../../utils/zoneLabel";
import {
  PURCHASE_SHEET_BACKGROUND,
  PURCHASE_SHEET_COLORS as C,
  PURCHASE_SHEET_HANDLE,
  PURCHASE_SHEET_PHONE_THEME,
} from "./purchaseSheetTheme";

export type AddIdentityStep =
  | "add"
  | "code"
  | "checking"
  | "found"
  | "none"
  | "link"
  | "landed"
  | "country"
  | "ask";

export type AddIdentityEntryStep = "add" | "link" | "ask" | "landed";

type Props = {
  visible: boolean;
  /** Which of the three "Bought it another way?" buttons opened the sheet. */
  initialStep?: AddIdentityEntryStep;
  userId: string | null;
  /** This account's confirmed contacts, used only for the ask-to-send message. */
  identifiers: readonly ClaimIdentifier[] | undefined;
  onClose: () => void;
  /** Fires after a sweep ran from inside the sheet, so "Last checked" updates. */
  onChecked?: (checkedAt: number) => void;
  /**
   * #4473 — "Is this your ticket?": the /c link a signed-in person opened that
   * the sweep did not attach. Required with initialStep "landed".
   */
  claimLink?: PendingClaim | null;
};

/** Which contact the link rail should prove, and how to show it masked. */
export function claimLinkContact(
  claim: PendingClaim | null | undefined,
): { channel: ClaimContactChannel; display: string } | null {
  if (!claim) return null;
  const email = claim.emailMasked
    ? { channel: "email" as const, display: claim.emailMasked }
    : null;
  const phone = claim.phoneLast4
    ? { channel: "phone" as const, display: `•••• ${claim.phoneLast4}` }
    : null;
  return claim.preferredProof === "phone" ? phone ?? email : email ?? phone;
}

type Found = { count: number; entries: ClaimedEntry[] };

/**
 * Steps that hold a text field. Moving between them keeps the sheet where the
 * keyboard put it; reaching any other step (Checking, a result, the other
 * ways) settles the sheet back to its resting height (BaseBottomSheet
 * `restingKey`), so it always sits flush at the bottom of the screen.
 */
const INPUT_STEPS: ReadonlySet<AddIdentityStep> = new Set(["add", "code"]);

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_SECONDS = 30;

export function AddIdentitySheet({
  visible,
  initialStep = "add",
  userId,
  identifiers,
  onClose,
  onChecked,
  claimLink = null,
}: Props): React.ReactElement {
  const { t } = useTranslation("purchases");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<AddIdentityStep>(initialStep);
  const [tab, setTab] = useState<ClaimContactChannel>("phone");
  const [email, setEmail] = useState("");
  const [phoneInput, setPhoneInput] = useState("");
  const [countryCode, setCountryCode] = useState<string>(
    () => defaultClaimPhoneCountry(getDefaultCountryCode()),
  );
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const [found, setFound] = useState<Found>({ count: 0, entries: [] });
  const fade = useRef(new Animated.Value(1)).current;
  // Keys the step body per open, so every open mounts a fresh native view.
  const [openCount, setOpenCount] = useState(0);
  const linkFlow = initialStep === "landed";
  const linkContact = claimLinkContact(claimLink);
  const runRef = useRef(0);
  const scrollRef = useRef<React.ElementRef<typeof BottomSheetScrollView>>(null);
  const focusScrollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The channel the code went to, so the code step's hint matches it.
  const codeChannel: ClaimContactChannel = linkFlow
    ? linkContact?.channel ?? "email"
    : tab;

  const normalizedEmail = email.trim().toLowerCase();
  const selectedCountry = useMemo(
    () => getCountryByCode(countryCode),
    [countryCode],
  );
  const phoneEntry = useMemo(
    () =>
      parsePhoneEntry(phoneInput, {
        countryIso: countryCode,
        dialCode: selectedCountry?.dialCode ?? null,
        mode: "mobile",
      }),
    [countryCode, phoneInput, selectedCountry?.dialCode],
  );
  // claim-contact texts only some countries; a pasted "+33 …" can move the
  // field to one it cannot reach, so that is refused here, in words.
  const phoneCountrySupported = isClaimPhoneCountry(
    phoneEntry.ok ? phoneEntry.countryIso ?? countryCode : countryCode,
  );
  const shaped = tab === "email"
    ? EMAIL_SHAPE.test(normalizedEmail)
    : phoneEntry.ok && phoneCountrySupported;
  const phoneProblem = !phoneCountrySupported && phoneInput.trim().length > 0
    ? t("missing.add.unsupportedCountry")
    : phoneTouched && !phoneEntry.ok && phoneInput.trim().length > 0
    ? phoneEntry.message
    : null;
  const contactLabel = sentTo ?? (
    linkFlow
      ? linkContact?.display ?? ""
      : tab === "email"
      ? normalizedEmail
      : phoneEntry.ok
      ? displayClaimIdentifier("phone", phoneEntry.e164)
      : ""
  );

  /**
   * Keep the focused field AND the primary button above the keyboard: the
   * sheet lifts with the keyboard (its Done bar is part of the keyboard), and
   * the body scrolls to its end once the keyboard has settled. No keyboard
   * listener: this runs on the field's own focus.
   */
  const revealPrimaryOnFocus = useCallback((): void => {
    if (focusScrollTimer.current) clearTimeout(focusScrollTimer.current);
    focusScrollTimer.current = setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 280);
  }, []);

  useEffect(() => () => {
    if (focusScrollTimer.current) clearTimeout(focusScrollTimer.current);
  }, []);

  const errorCopy = useCallback((errorCode: ClaimContactError["code"]): string => {
    switch (errorCode) {
      case "invalid_value": return t("missing.invalidValue");
      case "already_other_account": return t("missing.alreadyOtherAccount");
      case "limit_reached": return t("missing.limitReached");
      case "rate_limited":
      case "locked": return t("missing.rateLimited");
      case "bad_code":
      case "expired": return t("missing.badCode");
      case "no_contact": return t("missing.landed.noContact");
      case "link_expired": return t("missing.landed.expired");
      case "unsupported_phone": return t("missing.landed.unsupportedPhone");
      case "send_failed": return t("missing.landed.sendFailed");
      default: return t("error.body");
    }
  }, [t]);

  // Every step change cross-fades (also under reduced motion, per the spec).
  //
  // #4473 D6 — the sheet reopened blank: closing resets the step while the
  // modal tears down, so a native fade started then never finished and the
  // body stayed at opacity 0; reopening on the same step started no new fade.
  // Now: no fade runs while closed (the body is set fully visible), every open
  // starts a fresh fade on a freshly keyed body, and a fade that is
  // interrupted for any reason ends fully visible.
  useEffect(() => {
    if (!visible) {
      fade.stopAnimation();
      fade.setValue(1);
      return;
    }
    fade.setValue(0);
    Animated.timing(fade, {
      toValue: 1,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) fade.setValue(1);
    });
  }, [fade, step, visible]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(
      () => setResendIn((seconds) => Math.max(0, seconds - 1)),
      1_000,
    );
    return () => clearTimeout(timer);
  }, [resendIn]);

  useEffect(() => {
    if (visible) {
      setStep(initialStep);
      setOpenCount((count) => count + 1);
      return;
    }
    runRef.current += 1;
    setStep(initialStep);
    setTab("phone");
    setEmail("");
    setPhoneInput("");
    setCountryCode(defaultClaimPhoneCountry(getDefaultCountryCode()));
    setPhoneTouched(false);
    setChallengeId(null);
    setSentTo(null);
    setCode("");
    setBusy(false);
    setError(null);
    setResendIn(0);
    setFound({ count: 0, entries: [] });
  }, [initialStep, visible]);

  /** Confirmed: look for purchases, then show what was found (or nothing). */
  const check = useCallback(async (verified: {
    foundCount: number;
    claimed: ClaimedEntry[];
  }): Promise<void> => {
    const run = runRef.current;
    setStep("checking");
    setError(null);
    let entries = verified.claimed;
    let count = verified.foundCount;
    if (userId) {
      await queryClient
        .invalidateQueries({ queryKey: purchaseKeys.identifiers(userId) })
        .catch(() => undefined);
      try {
        const sweep = await runClaimSweep(userId, "add_identity");
        entries = mergeFoundEntries(entries, sweep.claimed);
        count = Math.max(count, sweep.count);
        onChecked?.(Date.now());
      } catch {
        // The verify result already stands; the sweep is a top-up.
      }
      if (verified.foundCount > 0 || verified.claimed.length > 0) {
        await queryClient
          .invalidateQueries({ queryKey: purchaseKeys.all })
          .catch(() => undefined);
      }
    }
    if (run !== runRef.current) return;
    count = Math.max(count, entries.length);
    setFound({ count, entries });
    if (count > 0) {
      setStep("found");
      // A haptic is a nicety; it must never stand between the person and
      // their tickets.
      try {
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => undefined);
      } catch {
        // No haptics engine here.
      }
      AccessibilityInfo.announceForAccessibility(
        t("missing.found.title", { count }),
      );
    } else {
      setStep("none");
    }
  }, [onChecked, t, userId]);

  const sendForLink = useCallback(async (): Promise<void> => {
    if (busy || !claimLink || !linkContact) return;
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    try {
      const result = await sendClaimLinkContactCode({
        code: claimLink.code,
        channel: linkContact.channel,
      });
      if (result.alreadyConfirmed) {
        setBusy(false);
        await check({ foundCount: result.foundCount, claimed: result.claimed });
        return;
      }
      if (!result.challengeId) throw new ClaimContactError("unavailable");
      setChallengeId(result.challengeId);
      setSentTo(result.sentTo ?? linkContact.display);
      setCode("");
      setResendIn(RESEND_SECONDS);
      setStep("code");
    } catch (reason) {
      setError(errorCopy(
        reason instanceof ClaimContactError ? reason.code : "unavailable",
      ));
    } finally {
      setBusy(false);
    }
  }, [busy, check, claimLink, errorCopy, linkContact]);

  const send = useCallback(async (): Promise<void> => {
    if (busy) return;
    if (linkFlow) {
      await sendForLink();
      return;
    }
    if (tab === "phone") setPhoneTouched(true);
    if (!shaped) {
      setError(
        tab === "email"
          ? t("missing.add.invalidEmail")
          : phoneEntry.ok ? null : phoneEntry.message,
      );
      return;
    }
    const value = tab === "email"
      ? normalizedEmail
      : phoneEntry.ok ? phoneEntry.e164 : "";
    // Close the keyboard while the field is still on screen, so the sheet
    // settles back to its resting height before the next step renders.
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    try {
      const result = await sendClaimContactCode({ channel: tab, value });
      if (result.alreadyConfirmed) {
        setSentTo(tab === "email" ? value : displayClaimIdentifier("phone", value));
        setBusy(false);
        await check({ foundCount: 0, claimed: [] });
        return;
      }
      if (!result.challengeId) throw new ClaimContactError("unavailable");
      setChallengeId(result.challengeId);
      setSentTo(result.sentTo);
      setCode("");
      setResendIn(RESEND_SECONDS);
      setStep("code");
    } catch (reason) {
      setError(errorCopy(
        reason instanceof ClaimContactError ? reason.code : "unavailable",
      ));
    } finally {
      setBusy(false);
    }
  }, [
    busy,
    check,
    errorCopy,
    linkFlow,
    normalizedEmail,
    phoneEntry,
    sendForLink,
    shaped,
    t,
    tab,
  ]);

  const verify = useCallback(async (candidate: string): Promise<void> => {
    if (!challengeId || candidate.length !== 6 || busy) return;
    // Same reason: the result steps must sit flush at the bottom, not at the
    // height the keyboard lifted the sheet to.
    Keyboard.dismiss();
    setBusy(true);
    setError(null);
    let result: { foundCount: number; claimed: ClaimedEntry[] };
    try {
      result = linkFlow
        ? await verifyClaimLinkContactCode({ challengeId, code: candidate })
        : await verifyClaimContactCode({ challengeId, code: candidate });
    } catch (reason) {
      setBusy(false);
      setError(errorCopy(
        reason instanceof ClaimContactError ? reason.code : "unavailable",
      ));
      return;
    }
    setBusy(false);
    await check(result);
  }, [busy, challengeId, check, errorCopy, linkFlow]);

  const paste = useCallback(async (): Promise<void> => {
    let pasted = "";
    try {
      pasted = (await Clipboard.getString()).replace(/\D/g, "").slice(0, 6);
    } catch {
      // Nothing readable on the clipboard; the boxes stay editable.
      return;
    }
    if (!pasted) return;
    setCode(pasted);
    setError(null);
    if (pasted.length === 6) await verify(pasted);
  }, [verify]);

  const openPath = (entry: ClaimedEntry): void => {
    onClose();
    router.push(claimedEntryPath(entry) as never);
  };

  const resetToAdd = (clearValue: boolean): void => {
    setChallengeId(null);
    setSentTo(null);
    setCode("");
    setError(null);
    if (clearValue) {
      setEmail("");
      setPhoneInput("");
      setPhoneTouched(false);
    }
    setStep(linkFlow ? "landed" : "add");
  };

  const stepLabel = {
    add: t("missing.step.add"),
    code: t("missing.step.code"),
    checking: t("missing.step.checking"),
    found: t("missing.step.found"),
    none: t("missing.step.none"),
    link: t("missing.step.other"),
    landed: t("missing.step.landed"),
    country: t("missing.step.add"),
    ask: t("missing.step.other"),
  }[step];

  const closable = !busy && step !== "checking";
  const sharedNote = hasSharedEntry(found.entries);
  const chatJoinedEverywhere = found.entries.length > 0 &&
    found.entries.every((entry) => entry.chatJoined === true);

  return (
    <BaseBottomSheet
      accessibilityLabel={t("missing.sheetTitle")}
      android_keyboardInputMode="adjustResize"
      backdropPressBehavior={closable ? "close" : "none"}
      backgroundStyle={PURCHASE_SHEET_BACKGROUND}
      enableDynamicSizing={false}
      enablePanDownToClose={closable}
      handleStyle={PURCHASE_SHEET_HANDLE}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      keyboardToolbar={PURCHASE_SHEET_KEYBOARD_TOOLBAR}
      onClose={closable ? onClose : () => undefined}
      restingKey={INPUT_STEPS.has(step) ? "input" : step}
      scrollMode="scroll"
      scrollProps={{
        ref: scrollRef,
        keyboardDismissMode: "interactive",
        keyboardShouldPersistTaps: "handled",
      }}
      snapPoints={["84%"]}
      theme="dark"
      topInset={insets.top}
      visible={visible}
      wrapInRNModal
    >
      <View style={styles.body} testID="add-identity-sheet">
        <View style={styles.topRow}>
          <Text style={styles.stepLabel}>{stepLabel}</Text>
          {closable ? (
            <Pressable
              accessibilityLabel={t("missing.close")}
              accessibilityRole="button"
              onPress={onClose}
              style={({ pressed }) => [styles.close, pressed && styles.pressed]}
              testID="add-identity-close"
            >
              <Svg height={14} viewBox="0 0 14 14" width={14}>
                <Path
                  d="M2 2l10 10M12 2 2 12"
                  stroke="rgba(255,255,255,0.8)"
                  strokeLinecap="round"
                  strokeWidth={2}
                />
              </Svg>
            </Pressable>
          ) : <View style={styles.close} />}
        </View>

        <Animated.View key={`body-${openCount}`} style={{ opacity: fade }} testID="add-identity-body">
          {step === "country" ? (
            <View testID="add-identity-country">
              <Text accessibilityRole="header" style={styles.title}>
                {t("missing.country.title")}
              </Text>
              <Text style={styles.description}>{t("missing.country.body")}</Text>
              <View accessibilityRole="radiogroup" style={styles.countryList}>
                {CLAIM_PHONE_COUNTRIES.map((iso) => {
                  const country = getCountryByCode(iso);
                  if (!country) return null;
                  const selected = countryCode === iso;
                  return (
                    <Pressable
                      accessibilityLabel={`${country.name}, ${country.dialCode}`}
                      accessibilityRole="radio"
                      accessibilityState={{ selected, checked: selected }}
                      key={iso}
                      onPress={() => {
                        setCountryCode(iso);
                        setPhoneInput("");
                        setPhoneTouched(false);
                        setError(null);
                        setStep("add");
                      }}
                      style={({ pressed }) => [
                        styles.countryRow,
                        selected && styles.countryRowSelected,
                        pressed && styles.pressed,
                      ]}
                      testID={`add-identity-country-${iso}`}
                    >
                      <Text style={styles.countryFlag}>{country.flag}</Text>
                      <Text style={styles.countryName}>{country.name}</Text>
                      <Text style={styles.countryDial}>{country.dialCode}</Text>
                    </Pressable>
                  );
                })}
              </View>
              <Pressable
                accessibilityRole="button"
                onPress={() => setStep("add")}
                style={({ pressed }) => [styles.outline, styles.outlineTight, pressed && styles.pressed]}
                testID="add-identity-country-back"
              >
                <Text style={styles.outlineText}>{t("missing.country.back")}</Text>
              </Pressable>
            </View>
          ) : null}

          {step === "add" ? (
            <View>
              <Text accessibilityRole="header" style={styles.title}>
                {t("missing.sheetTitle")}
              </Text>
              <Text style={styles.description}>{t("missing.add.body")}</Text>
              <View
                accessibilityLabel={t("missing.add.tabsLabel")}
                accessibilityRole="tablist"
                style={styles.tabs}
              >
                {(["email", "phone"] as const).map((channel) => {
                  const selected = tab === channel;
                  return (
                    <Pressable
                      accessibilityRole="tab"
                      accessibilityState={{ selected, disabled: busy }}
                      disabled={busy}
                      key={channel}
                      onPress={() => {
                        setTab(channel);
                        setError(null);
                      }}
                      style={({ pressed }) => [
                        styles.tab,
                        selected && styles.tabSelected,
                        pressed && styles.pressed,
                      ]}
                      testID={`add-identity-tab-${channel}`}
                    >
                      <Text style={[styles.tabText, selected && styles.tabTextSelected]}>
                        {channel === "email" ? t("missing.email") : t("missing.mobile")}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {tab === "phone" ? (
                <View>
                  <Text style={styles.label}>{t("missing.add.mobileLabel")}</Text>
                  <PhoneInput
                    countryCode={countryCode}
                    disabled={busy}
                    error={phoneProblem}
                    inputComponent={BottomSheetTextInput}
                    onBlur={() => setPhoneTouched(true)}
                    onChangeCountry={setCountryCode}
                    onFocus={revealPrimaryOnFocus}
                    onRequestCountryPicker={() => setStep("country")}
                    placeholder={claimPhonePlaceholder(countryCode)}
                    onChangePhone={(next) => {
                      setPhoneInput(next);
                      setError(null);
                    }}
                    phoneInputAccessibilityLabel={t("missing.add.mobileLabel")}
                    required
                    smartEntry
                    testID="add-identity-phone"
                    // #4508: this sheet has no shared bar on iOS; the field keeps its own.
                    showDoneAccessory
                    theme={PURCHASE_SHEET_PHONE_THEME}
                    value={phoneInput}
                  />
                  <Text style={styles.hint}>{t("missing.add.mobileHint")}</Text>
                </View>
              ) : (
                <View>
                  <Text style={styles.label}>{t("missing.add.emailLabel")}</Text>
                  <BottomSheetTextInput
                    accessibilityLabel={t("missing.add.emailLabel")}
                    autoCapitalize="none"
                    autoComplete="email"
                    autoCorrect={false}
                    editable={!busy}
                    inputMode="email"
                    keyboardType="email-address"
                    onChangeText={(next: string) => {
                      setEmail(next);
                      setError(null);
                    }}
                    inputAccessoryViewID={EMAIL_DONE_BAR_ID}
                    onFocus={revealPrimaryOnFocus}
                    onSubmitEditing={() => { void send(); }}
                    placeholder={t("missing.add.emailPlaceholder")}
                    placeholderTextColor={C.placeholder}
                    returnKeyType="send"
                    style={[styles.input, error ? styles.inputError : null]}
                    testID="add-identity-email"
                    textContentType="emailAddress"
                    value={email}
                  />
                  <SheetKeyboardDoneBar nativeID={EMAIL_DONE_BAR_ID} />
                  <Text style={styles.hint}>{t("missing.add.emailHint")}</Text>
                </View>
              )}

              {error ? (
                <Text accessibilityRole="alert" style={styles.error} testID="add-identity-error">
                  {error}
                </Text>
              ) : null}

              <Pressable
                accessibilityRole="button"
                accessibilityState={{ disabled: busy || !shaped, busy }}
                disabled={busy || !shaped}
                onPress={() => { void send(); }}
                style={({ pressed }) => [
                  styles.primary,
                  (busy || !shaped) && styles.disabled,
                  pressed && styles.pressed,
                ]}
                testID="add-identity-send"
              >
                {busy ? <ActivityIndicator color="#fff" style={styles.spinner} /> : null}
                <Text style={styles.primaryText}>{t("missing.sendCode")}</Text>
              </Pressable>
            </View>
          ) : null}

          {step === "code" ? (
            <View>
              <Text accessibilityRole="header" style={styles.title}>
                {t("missing.codeTitle")}
              </Text>
              <View style={styles.sentRow}>
                <Text style={styles.sentText}>
                  {t("missing.codeSentTo", { value: contactLabel })}
                </Text>
                <Pressable
                  accessibilityLabel={t("missing.code.changeLabel")}
                  accessibilityRole="button"
                  disabled={busy}
                  hitSlop={6}
                  onPress={() => resetToAdd(false)}
                  style={({ pressed }) => [styles.chip, pressed && styles.pressed]}
                  testID="add-identity-change"
                >
                  <Text style={styles.chipText}>{t("missing.code.change")}</Text>
                </Pressable>
              </View>
              <View style={styles.otp}>
                <OTPInput
                  disabled={busy}
                  error={error !== null}
                  inputAccessoryViewID={CODE_DONE_BAR_ID}
                  inputComponent={BottomSheetTextInput}
                  length={6}
                  onChange={(next) => {
                    setCode(next);
                    if (error) setError(null);
                  }}
                  onComplete={(next) => { void verify(next); }}
                  tone="dark"
                  value={code}
                />
                <SheetKeyboardDoneBar nativeID={CODE_DONE_BAR_ID} />
              </View>
              {busy ? (
                <ActivityIndicator color={C.accent} style={styles.verifying} />
              ) : null}
              {error ? (
                <Text accessibilityRole="alert" style={styles.error} testID="add-identity-error">
                  {error}
                </Text>
              ) : null}
              <View style={styles.codeActions}>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => { void paste(); }}
                  style={({ pressed }) => [styles.secondaryHalf, pressed && styles.pressed]}
                  testID="add-identity-paste"
                >
                  <Text style={styles.secondaryHalfText}>{t("missing.code.paste")}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy || resendIn > 0 }}
                  disabled={busy || resendIn > 0}
                  onPress={() => { void send(); }}
                  style={({ pressed }) => [
                    styles.secondaryHalf,
                    resendIn > 0 && styles.secondaryHalfMuted,
                    pressed && styles.pressed,
                  ]}
                  testID="add-identity-resend"
                >
                  <Text
                    style={[
                      styles.secondaryHalfText,
                      resendIn > 0 && styles.mutedText,
                    ]}
                  >
                    {resendIn > 0
                      ? t("missing.code.resendIn", { time: resendClock(resendIn) })
                      : t("missing.resend")}
                  </Text>
                </Pressable>
              </View>
              <Text style={styles.hint}>
                {codeChannel === "email"
                  ? t("missing.code.hintEmail")
                  : Platform.OS === "ios"
                  ? t("missing.code.hintIos")
                  : t("missing.code.hint")}
              </Text>
            </View>
          ) : null}

          {step === "checking" ? (
            <View
              accessibilityLiveRegion="polite"
              style={styles.checking}
              testID="add-identity-checking"
            >
              <ActivityIndicator color={C.accent} size="large" />
              <Text style={styles.checkingTitle}>{t("missing.checking.title")}</Text>
              <Text style={styles.checkingBody}>
                {t("missing.checking.body", { value: contactLabel })}
              </Text>
            </View>
          ) : null}

          {step === "found" ? (
            <View testID="add-identity-found">
              <View style={styles.foundHead}>
                <View style={styles.successDot}>
                  <Svg height={18} viewBox="0 0 14 14" width={18}>
                    <Path
                      d="M3 7.5 6 10l5-6"
                      fill="none"
                      stroke={C.success}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.2}
                    />
                  </Svg>
                </View>
                <Text accessibilityRole="header" style={[styles.title, styles.foundTitle]}>
                  {t("missing.found.title", { count: found.count })}
                </Text>
              </View>
              <Text style={styles.description}>
                {chatJoinedEverywhere
                  ? t("missing.found.bodyChat", { count: found.count })
                  : t("missing.found.body", { count: found.count })}
              </Text>
              <View style={styles.cards}>
                {found.entries.map((entry, index) => (
                  <RiseIn delay={index * 60} key={`${entry.kind}:${entry.id}`}>
                    <FoundCard
                      entry={entry}
                      onOpen={() => openPath(entry)}
                      openLabel={t("missing.found.openLabel", { title: entry.title })}
                      openText={t("missing.found.open")}
                    />
                  </RiseIn>
                ))}
              </View>
              {sharedNote ? (
                <View style={styles.info} testID="add-identity-shared-note">
                  <Svg height={18} style={styles.infoIcon} viewBox="0 0 24 24" width={18}>
                    <Circle cx={12} cy={12} fill="none" r={9} stroke={C.infoIcon} strokeWidth={2} />
                    <Path d="M12 11v6M12 7.5v.5" stroke={C.infoIcon} strokeLinecap="round" strokeWidth={2.2} />
                  </Svg>
                  <Text style={styles.infoText}>
                    {t(sharedNoteKey(found.entries), {
                      value: contactLabel,
                      count: found.entries.filter((entry) => entry.sharedWithAnotherAccount).length,
                    })}
                  </Text>
                </View>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={onClose}
                style={({ pressed }) => [styles.outline, pressed && styles.pressed]}
                testID="add-identity-done"
              >
                <Text style={styles.outlineText}>{t("missing.found.done")}</Text>
              </Pressable>
            </View>
          ) : null}

          {step === "none" ? (
            <View testID="add-identity-none">
              <Text accessibilityRole="header" style={styles.title}>
                {t("missing.none.title", { value: contactLabel })}
              </Text>
              <Text style={styles.description}>{t("missing.none.body")}</Text>
              <View style={styles.stack}>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setStep("link")}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                  testID="add-identity-none-link"
                >
                  <Text style={styles.optionText}>{t("missing.options.link.title")}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setStep("ask")}
                  style={({ pressed }) => [styles.option, pressed && styles.pressed]}
                  testID="add-identity-none-ask"
                >
                  <Text style={styles.optionText}>{t("missing.options.ask.title")}</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  onPress={() => resetToAdd(true)}
                  style={({ pressed }) => [styles.primary, styles.primaryTight, pressed && styles.pressed]}
                  testID="add-identity-none-retry"
                >
                  <Text style={styles.primaryText}>{t("missing.none.tryAnother")}</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {step === "landed" ? (
            <View testID="add-identity-landed">
              <Text accessibilityRole="header" style={styles.title}>
                {t(claimLinkLandedTitleKey(claimLink?.noun ?? null))}
              </Text>
              {claimLink ? (
                <View style={[styles.card, styles.landedCard]}>
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={styles.cardTile}
                  >
                    <Text style={styles.cardTileText}>
                      {claimLink.title.trim().charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View style={styles.cardCopy}>
                    <Text style={styles.cardTitle}>{claimLink.title}</Text>
                    {[
                      formatStartsAtLabel(claimLink.startsAt, claimLink.timezone),
                      claimLink.orderLabel,
                    ].filter(Boolean).length > 0 ? (
                      <Text style={styles.cardMeta}>
                        {[
                          formatStartsAtLabel(claimLink.startsAt, claimLink.timezone),
                          claimLink.orderLabel,
                        ].filter(Boolean).join(" · ")}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ) : null}
              {claimLink?.expired ? (
                <Text style={styles.description}>{t("missing.landed.expired")}</Text>
              ) : linkContact ? (
                <Text style={styles.description}>
                  {t(
                    linkContact.channel === "email"
                      ? "missing.landed.bodyEmail"
                      : "missing.landed.bodyPhone",
                    { contact: linkContact.display },
                  )}
                </Text>
              ) : (
                <Text style={styles.description}>{t("missing.landed.noContact")}</Text>
              )}
              {error ? (
                <Text accessibilityRole="alert" style={styles.error} testID="add-identity-error">
                  {error}
                </Text>
              ) : null}
              {linkContact && !claimLink?.expired ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ disabled: busy, busy }}
                  disabled={busy}
                  onPress={() => { void send(); }}
                  style={({ pressed }) => [
                    styles.primary,
                    busy && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                  testID="add-identity-landed-send"
                >
                  {busy ? <ActivityIndicator color="#fff" style={styles.spinner} /> : null}
                  <Text style={styles.primaryText}>
                    {t("missing.landed.send", { contact: linkContact.display })}
                  </Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setStep("ask")}
                style={({ pressed }) => [styles.outline, styles.outlineTight, pressed && styles.pressed]}
                testID="add-identity-landed-ask"
              >
                <Text style={styles.outlineText}>
                  {linkContact?.channel === "phone"
                    ? t("missing.landed.cantPhone")
                    : t("missing.landed.cantInbox")}
                </Text>
              </Pressable>
            </View>
          ) : null}
          {step === "link" ? <ConfirmationLinkStep onDone={onClose} /> : null}
          {step === "ask" ? <AskSenderStep identifiers={identifiers} /> : null}
        </Animated.View>
      </View>
    </BaseBottomSheet>
  );
}

/**
 * The "also confirmed on another account" note, worded for what was found:
 * a ticket or RSVP pass scans once at the door; a booking or a receipt makes
 * no QR claim (a stay has none, and nothing is "a ticket").
 */
export function sharedNoteKey(entries: readonly ClaimedEntry[]): string {
  const shared = entries.filter((entry) => entry.sharedWithAnotherAccount === true);
  const nouns = new Set(shared.map((entry) => entry.noun));
  if (shared.length > 1 && nouns.size > 1) return "missing.found.shared.mixed";
  const noun = shared[0]?.noun ?? "ticket";
  return `missing.found.shared.${noun}`;
}

function FoundCard({
  entry,
  onOpen,
  openLabel,
  openText,
}: {
  entry: ClaimedEntry;
  onOpen: () => void;
  openLabel: string;
  openText: string;
}): React.ReactElement {
  const meta = claimedEntryMetaLine(entry);
  return (
    <View style={styles.card}>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={styles.cardTile}
      >
        <Text style={styles.cardTileText}>
          {entry.title.trim().charAt(0).toUpperCase()}
        </Text>
      </View>
      <View style={styles.cardCopy}>
        <Text style={styles.cardTitle}>{entry.title}</Text>
        {meta ? <Text style={styles.cardMeta}>{meta}</Text> : null}
      </View>
      <Pressable
        accessibilityLabel={openLabel}
        accessibilityRole="button"
        hitSlop={4}
        onPress={onOpen}
        style={({ pressed }) => [styles.openPill, pressed && styles.pressed]}
        testID={`add-identity-open-${entry.id}`}
      >
        <Text style={styles.openText}>{openText}</Text>
      </Pressable>
    </View>
  );
}

/** Rise 12 px and fade in, unless the person asked for reduced motion. */
function RiseIn({
  delay,
  children,
}: {
  delay: number;
  children: React.ReactNode;
}): React.ReactElement {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((reduceMotion) => {
        if (cancelled) return;
        if (reduceMotion) {
          progress.setValue(1);
          return;
        }
        Animated.timing(progress, {
          toValue: 1,
          duration: 220,
          delay,
          useNativeDriver: true,
        }).start();
      });
    return () => {
      cancelled = true;
    };
  }, [delay, progress]);
  return (
    <Animated.View
      style={{
        opacity: progress,
        transform: [{
          translateY: progress.interpolate({
            inputRange: [0, 1],
            outputRange: [12, 0],
          }),
        }],
      }}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: 20, paddingBottom: 34 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 4,
  },
  stepLabel: {
    color: C.textMeta,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.1,
    textTransform: "uppercase",
  },
  close: {
    width: 44,
    height: 44,
    marginRight: -10,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { color: C.text, fontSize: 24, lineHeight: 30, fontWeight: "800" },
  description: {
    color: C.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  tabs: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: 14,
    backgroundColor: C.field,
    marginTop: 18,
  },
  tab: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  tabSelected: { backgroundColor: C.tabSelected },
  tabText: { color: C.textTab, fontSize: 14, fontWeight: "600" },
  tabTextSelected: { color: C.text, fontWeight: "700" },
  label: {
    color: C.textLabel,
    fontSize: 13,
    fontWeight: "600",
    marginTop: 16,
    marginBottom: 6,
  },
  input: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: C.borderStrong,
    backgroundColor: C.field,
    color: C.text,
    fontSize: 17,
    paddingHorizontal: 14,
  },
  inputError: { borderColor: C.error },
  hint: { color: C.textMeta, fontSize: 12, lineHeight: 17, marginTop: 6 },
  error: { color: C.error, fontSize: 13, lineHeight: 18, marginTop: 10 },
  primary: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    marginTop: 20,
  },
  primaryTight: { marginTop: 0 },
  primaryText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  spinner: { marginRight: 10 },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.7 },
  sentRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 6,
  },
  sentText: { color: C.textSecondary, fontSize: 14, lineHeight: 20 },
  chip: {
    minHeight: 32,
    paddingHorizontal: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    justifyContent: "center",
  },
  chipText: { color: C.text, fontSize: 12, fontWeight: "600" },
  otp: { marginTop: 20 },
  verifying: { marginTop: 12 },
  codeActions: { flexDirection: "row", gap: 8, marginTop: 14 },
  secondaryHalf: {
    flex: 1,
    minHeight: 46,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.borderStrong,
    backgroundColor: C.field,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryHalfMuted: { borderColor: C.border },
  secondaryHalfText: { color: C.text, fontSize: 14, fontWeight: "600" },
  mutedText: { color: C.textMeta },
  checking: {
    minHeight: 260,
    alignItems: "center",
    justifyContent: "center",
    gap: 14,
  },
  checkingTitle: {
    color: C.text,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  checkingBody: {
    color: C.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  foundHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  foundTitle: { flex: 1 },
  successDot: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.successTint,
    alignItems: "center",
    justifyContent: "center",
  },
  cards: { gap: 10, marginTop: 14 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.field,
  },
  cardTile: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: C.accentTint,
    alignItems: "center",
    justifyContent: "center",
  },
  cardTileText: { color: C.accent, fontSize: 20, fontWeight: "800" },
  cardCopy: { flex: 1, minWidth: 0 },
  cardTitle: { color: C.text, fontSize: 15, fontWeight: "700" },
  cardMeta: { color: "rgba(255,255,255,0.62)", fontSize: 12, marginTop: 2 },
  openPill: {
    minHeight: 40,
    minWidth: 44,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: C.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  openText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  info: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.infoBorder,
    backgroundColor: C.infoFill,
  },
  infoIcon: { marginTop: 1 },
  infoText: { flex: 1, color: C.infoText, fontSize: 13, lineHeight: 19 },
  outline: {
    minHeight: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: C.borderStrong,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
  },
  outlineText: { color: C.text, fontSize: 16, fontWeight: "700" },
  outlineTight: { marginTop: 10, minHeight: 50 },
  landedCard: { marginTop: 14 },
  stack: { gap: 10, marginTop: 16 },
  option: {
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: C.field,
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  optionText: { color: C.text, fontSize: 15, fontWeight: "600" },
  countryList: { gap: 8, marginTop: 16 },
  countryRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.field,
  },
  countryRowSelected: { borderColor: C.accent },
  countryFlag: { fontSize: 22 },
  countryName: { flex: 1, color: C.text, fontSize: 15, fontWeight: "600" },
  countryDial: { color: C.textSecondary, fontSize: 15 },
});
