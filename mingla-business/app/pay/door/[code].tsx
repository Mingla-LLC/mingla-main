/**
 * /pay/door/[code] — the guest's "pay at the door" page (issue #4271, B2–B5).
 *
 * The guest scanned the host's door pay code with their own phone camera.
 * Anonymous on purpose (the `/pay/` prefix is a public buyer route; no auth
 * hook): the short-lived, pays-once code is the credential. The basket is
 * locked to what the host chose. The guest gives their name, email and mobile
 * (required, as online checkout requires) and is handed to the provider's page
 * exactly as online checkout does: Stripe's hosted page or Paystack.
 *
 * Returning with `?paid=1` polls the code until it reads paid or the server
 * names a late refund. A guest coming back from the provider's page is never told
 * they weren't charged: a closed code alone doesn't prove that. The paid page shows
 * no QR (#4063): the door has already checked them in.
 *
 * Pre-purchase copy talks about the ticket, never the app (#4063).
 *
 * Door polish (#4271): the event name joins the eyebrow line after a middle
 * dot (the #4063 gate mutates the eyebrow literal, so it is not repeated in
 * this comment), the brand and venue line goes (the guest is standing there), the
 * labels drop the asterisks (one line says all three are needed), the fields
 * carry autofill hints, the button names the amount, and the end states use
 * the door tones (expired and cancelled grey, failed red, paid green).
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";

import { Button } from "../../../src/components/ui/Button";
import { Icon } from "../../../src/components/ui/Icon";
import { Input } from "../../../src/components/ui/Input";
import { PhoneField, usePhoneEntry } from "../../../src/components/ui/PhoneField";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import {
  accent,
  canvas,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
  typography,
} from "../../../src/constants/designSystem";
import {
  PURCHASE_PRIVACY_URL,
  PURCHASE_TERMS_DISCLOSURE_TEXT,
  PURCHASE_TERMS_DISCLOSURE_VERSION,
  PURCHASE_TERMS_LABEL_JOINER,
  PURCHASE_TERMS_LABEL_PREFIX,
  PURCHASE_TERMS_LABEL_PRIVACY,
  PURCHASE_TERMS_LABEL_SUFFIX,
  PURCHASE_TERMS_LABEL_TERMS,
  PURCHASE_TERMS_URL,
} from "../../../src/constants/consentDisclosure";
import { DOWNLOAD_PAGE_URL } from "../../../src/constants/storeLinks";
import {
  doorPayGuestEndCopy,
  doorPayGuestLateCopy,
  doorPayGuestReturnSettled,
} from "../../../src/components/door/doorPayGuestState";
import {
  DOOR_PAY_GUEST_TONE_STYLES,
  doorPayGuestTone,
  type DoorPayGuestTone,
} from "../../../src/components/door/doorPayGuestTone";
import { recordConsent } from "../../../src/services/consentService";
import {
  createDoorCodeCheckout,
  DoorPayCodeError,
  viewDoorPayCode,
  type DoorPayCodeView,
} from "../../../src/services/doorPayCodeService";
import { formatCurrency } from "../../../src/utils/currency";
import { phoneStartCountryForCurrency } from "../../../src/utils/phoneStartCountryForCurrency";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_MIN_CHARS = 2;
const POLL_INTERVAL_MS = 2_000;
const POLL_BUDGET_MS = 45_000;
const CONTACT_KEY_PREFIX = "mingla.door-pay.contact.";

type PageState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "not_found" }
  | { kind: "ready"; view: DoorPayCodeView }
  | { kind: "returning" }
  | { kind: "pending"; view: DoorPayCodeView | null }
  | { kind: "paid"; view: DoorPayCodeView; justPaid: boolean };

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? "";

/** Codes are read aloud as "K7Q2-M9XA"; accept either form. */
const normalizeCode = (raw: string): string => raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

interface StoredContact {
  email: string;
  phone: string;
}

const storage = (): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } | null => {
  if (Platform.OS !== "web") return null;
  try {
    const s = (globalThis as { sessionStorage?: Storage }).sessionStorage;
    return s ?? null;
  } catch {
    return null;
  }
};

const readContact = (code: string): StoredContact | null => {
  try {
    const raw = storage()?.getItem(`${CONTACT_KEY_PREFIX}${code}`) ?? null;
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const p = parsed as Record<string, unknown>;
    return typeof p.email === "string" && typeof p.phone === "string"
      ? { email: p.email, phone: p.phone }
      : null;
  } catch {
    return null;
  }
};

const writeContact = (code: string, contact: StoredContact): void => {
  try {
    storage()?.setItem(`${CONTACT_KEY_PREFIX}${code}`, JSON.stringify(contact));
  } catch {
    // Private mode: the paid page falls back to a generic sign-in line.
  }
};

const money = (cents: number, currency: string): string =>
  currency.length > 0 ? formatCurrency(cents, currency, true) : "—";

/** Door polish: the button names the amount, so no separate label is needed. */
const doorPayGuestContinueLabel = (amount: string): string => `Continue to pay ${amount}`;

const doorPayGuestEyebrow = (eventName: string | null | undefined): string =>
  typeof eventName === "string" && eventName.trim().length > 0
    ? `PAY AT THE DOOR · ${eventName.trim().toUpperCase()}`
    : "PAY AT THE DOOR";

const assignLocation = (url: string): boolean => {
  const w = globalThis as unknown as { location?: { assign?: (u: string) => void } };
  if (typeof w.location?.assign !== "function") return false;
  w.location.assign(url);
  return true;
};

export default function DoorPayGuestPage(): React.ReactElement {
  const params = useLocalSearchParams<{ code?: string | string[]; paid?: string | string[] }>();
  const code = normalizeCode(first(params.code));
  const isReturning = first(params.paid) === "1";
  const [page, setPage] = useState<PageState>({ kind: "loading" });
  const lastView = useRef<DoorPayCodeView | null>(null);
  // "Check again" on a returning guest polls again, never the plain load.
  const [pollRound, setPollRound] = useState<number>(0);

  const load = useCallback(async (): Promise<void> => {
    setPage({ kind: "loading" });
    try {
      const view = await viewDoorPayCode(code);
      lastView.current = view;
      setPage(view.status === "paid" ? { kind: "paid", view, justPaid: false } : { kind: "ready", view });
    } catch (error) {
      setPage(
        error instanceof DoorPayCodeError && (error.status === 404 || error.code === "not_found")
          ? { kind: "not_found" }
          : { kind: "error" },
      );
    }
  }, [code]);

  useEffect(() => {
    let cancelled = false;
    if (!isReturning) {
      void load();
      return (): void => {
        cancelled = true;
      };
    }
    setPage({ kind: "returning" });
    const startedAt = Date.now();
    const poll = async (): Promise<void> => {
      while (!cancelled && Date.now() - startedAt < POLL_BUDGET_MS) {
        try {
          const view = await viewDoorPayCode(code);
          lastView.current = view;
          if (doorPayGuestReturnSettled(view)) {
            if (!cancelled) {
              setPage(view.status === "paid" ? { kind: "paid", view, justPaid: true } : { kind: "ready", view });
            }
            return;
          }
        } catch {
          // A transient poll failure does not replace the confirming state.
        }
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      if (!cancelled) setPage({ kind: "pending", view: lastView.current });
    };
    void poll();
    return (): void => {
      cancelled = true;
    };
  }, [code, isReturning, load, pollRound]);

  let content: React.ReactNode;
  if (page.kind === "loading" || page.kind === "returning") {
    content = (
      <StateCard
        title={page.kind === "returning" ? "Checking your payment…" : "Loading…"}
        body={page.kind === "returning" ? "Please keep this page open while we confirm it." : ""}
        busy
      />
    );
  } else if (page.kind === "error") {
    content = (
      <StateCard
        title="We couldn't load this payment"
        body="Check your connection and try again."
        action="Try again"
        onAction={() => void load()}
      />
    );
  } else if (page.kind === "not_found") {
    content = (
      <StateCard
        title="This code isn't valid"
        body="Check the code with the door, or ask them to show a new one. You haven't been charged."
      />
    );
  } else if (page.kind === "pending") {
    content = (
      <StateCard
        title="We're still confirming your payment"
        body="This can take a minute. Show this screen at the door if you're asked. You won't be charged twice."
        action="Check again"
        onAction={() => setPollRound((round) => round + 1)}
      />
    );
  } else if (page.kind === "paid") {
    content = page.justPaid ? (
      <PaidCard view={page.view} contact={readContact(code)} />
    ) : (
      <StateCard {...doorPayGuestEndCopy("paid", page.view.provider)} tone={doorPayGuestTone("paid")} />
    );
  } else {
    const view = page.view;
    if (view.latePayment != null) {
      content = (
        <StateCard
          {...doorPayGuestLateCopy(
            view.latePayment.state,
            money(view.latePayment.amountCents, view.latePayment.currency || view.currency),
          )}
        />
      );
    } else if (view.status === "open" || view.status === "opened") {
      content = <PayForm code={code} view={view} />;
    } else if (view.status === "paid") {
      content = <StateCard {...doorPayGuestEndCopy("paid", view.provider)} tone={doorPayGuestTone("paid")} />;
    } else if (view.status === "payment_landing" || view.status === "checking") {
      content = (
        <StateCard
          title="Checking this payment"
          body="A payment on this code is being confirmed. If it was yours, you won't be charged twice."
          action="Check again"
          onAction={() => void load()}
        />
      );
    } else {
      content = (
        <StateCard {...doorPayGuestEndCopy(view.status, view.provider)} tone={doorPayGuestTone(view.status)} />
      );
    }
  }

  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.screen}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.wordmark}>
          <Text style={styles.wordmarkText}>Mingla</Text>
        </View>
        {content}
      </ScrollView>
    </SafeScreen>
  );
}

// ---- B2: the locked basket + buyer details --------------------------------

const PayForm: React.FC<{ code: string; view: DoorPayCodeView }> = ({ code, view }) => {
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [termsAccepted, setTermsAccepted] = useState<boolean>(false);
  const [showErrors, setShowErrors] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [endStatus, setEndStatus] = useState<"expired" | "paid" | "cancelled" | "failed" | null>(null);
  const [codeInvalid, setCodeInvalid] = useState<boolean>(false);
  const phone = usePhoneEntry({ startCountries: [phoneStartCountryForCurrency(view.currency)] });

  const nameValid = name.trim().length >= NAME_MIN_CHARS;
  const emailValid = EMAIL_REGEX.test(email.trim());
  const phoneValid = phone.e164 !== null;
  const formValid = nameValid && emailValid && phoneValid;

  const handleContinue = useCallback(async (): Promise<void> => {
    setShowErrors(true);
    if (!formValid || phone.e164 === null) return;
    if (!termsAccepted) {
      setSubmitError("Please agree to the terms to continue.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    const buyerPhone = phone.e164;
    const buyerEmail = email.trim().toLowerCase();
    try {
      const consent = await recordConsent({
        source: "checkout",
        disclosureText: PURCHASE_TERMS_DISCLOSURE_TEXT,
        disclosureVersion: PURCHASE_TERMS_DISCLOSURE_VERSION,
        scopes: ["transactional"],
        phone: buyerPhone,
        email: buyerEmail,
        countryCode: phone.countryIso,
        userId: null,
        eventId: view.eventId ?? null,
      });
      if (!consent.ok) {
        console.error("[door-pay] consent_records write failed (proceeding; checkbox act stands)");
      }
      const handoff = await createDoorCodeCheckout({
        doorCode: code,
        ...(view.eventId !== undefined ? { eventId: view.eventId } : {}),
        buyer: {
          name: name.trim(),
          email: buyerEmail,
          phone: buyerPhone,
          marketingOptIn: false,
          termsAccepted: true,
        },
      });
      writeContact(code, { email: buyerEmail, phone: buyerPhone });
      if (assignLocation(handoff.redirectUrl)) return;
      setSubmitError("Couldn't open the payment page. You haven't been charged. Try again.");
    } catch (error) {
      if (error instanceof DoorPayCodeError && error.code === "door_code_unavailable") {
        // 409 {status}: paid / expired / cancelled / failed, or "not_found"
        // (not a code status) when the code no longer matches this event.
        if (error.codeStatus === null) setCodeInvalid(true);
        else if (
          error.codeStatus === "expired" || error.codeStatus === "paid" ||
          error.codeStatus === "cancelled" || error.codeStatus === "failed"
        ) {
          setEndStatus(error.codeStatus);
        } else {
          setSubmitError("This code is still being checked. Try again in a moment.");
        }
      } else if (error instanceof DoorPayCodeError && error.code === "purchase_terms_required") {
        setTermsAccepted(false);
        setSubmitError("Please agree to the terms to continue.");
      } else if (error instanceof DoorPayCodeError && error.status === null) {
        setSubmitError("We couldn't reach the payment page. Check your connection and try again. You haven't been charged.");
      } else {
        setSubmitError("Something went wrong starting your payment. You haven't been charged. Try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }, [code, email, formValid, name, phone.countryIso, phone.e164, termsAccepted, view.eventId]);

  if (codeInvalid) {
    return (
      <StateCard
        title="This code isn't valid"
        body="Check the code with the door, or ask them to show a new one. You haven't been charged."
      />
    );
  }
  if (endStatus !== null) {
    return <StateCard {...doorPayGuestEndCopy(endStatus, view.provider)} tone={doorPayGuestTone(endStatus)} />;
  }

  return (
    <View style={styles.card} testID="door-pay-form">
      <Text style={styles.eyebrow} accessibilityRole="header">
        {doorPayGuestEyebrow(view.eventName)}
      </Text>
      <View style={styles.basket}>
        {view.lines.map((line) => (
          <View key={line.ticketTypeId} style={styles.kv}>
            <Text style={styles.kvKey}>
              {line.quantity}× {line.name}
            </Text>
            <Text style={styles.kvValue}>{money(line.unitCents * line.quantity, view.currency)}</Text>
          </View>
        ))}
        {view.feeCents > 0 ? (
          <View style={styles.kv}>
            <Text style={styles.kvKey}>Fees</Text>
            <Text style={styles.kvValue}>{money(view.feeCents, view.currency)}</Text>
          </View>
        ) : null}
        <View style={styles.kv}>
          <Text style={styles.kvStrong}>Total</Text>
          <Text style={styles.kvStrong}>{money(view.totalCents, view.currency)}</Text>
        </View>
      </View>

      <Text style={styles.faint}>All three are needed for your ticket.</Text>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Full name</Text>
        <Input
          value={name}
          onChangeText={setName}
          variant="text"
          placeholder="Full name"
          autoComplete="name"
          textContentType="name"
          accessibilityLabel="Full name, required"
        />
        {showErrors && !nameValid ? <Text style={styles.errorText}>Please enter your full name</Text> : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Email</Text>
        <Input
          value={email}
          onChangeText={setEmail}
          variant="email"
          placeholder="Email"
          autoComplete="email"
          textContentType="emailAddress"
          accessibilityLabel="Email address, required"
        />
        {showErrors && !emailValid ? <Text style={styles.errorText}>Enter a valid email</Text> : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Mobile number</Text>
        <PhoneField
          entry={phone}
          required
          showErrors={showErrors}
          accessibilityLabel="Mobile number"
          placeholder="Mobile number"
          testID="door-pay-buyer-phone"
        />
      </View>
      <Text style={styles.faint}>Your ticket is sent to this email and number.</Text>

      <Pressable
        onPress={() => setTermsAccepted((v) => !v)}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: termsAccepted }}
        accessibilityLabel={PURCHASE_TERMS_DISCLOSURE_TEXT}
        style={styles.checkboxRow}
      >
        <View style={[styles.checkboxBox, termsAccepted && styles.checkboxBoxChecked]}>
          {termsAccepted ? <Icon name="check" size={14} color={textTokens.primary} /> : null}
        </View>
        <Text style={styles.checkboxLabel}>
          {PURCHASE_TERMS_LABEL_PREFIX}
          <Text style={styles.link} onPress={() => void Linking.openURL(PURCHASE_TERMS_URL)} accessibilityRole="link">
            {PURCHASE_TERMS_LABEL_TERMS}
          </Text>
          {PURCHASE_TERMS_LABEL_JOINER}
          <Text style={styles.link} onPress={() => void Linking.openURL(PURCHASE_PRIVACY_URL)} accessibilityRole="link">
            {PURCHASE_TERMS_LABEL_PRIVACY}
          </Text>
          {PURCHASE_TERMS_LABEL_SUFFIX}
        </Text>
      </Pressable>

      {submitError !== null ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {submitError}
        </Text>
      ) : null}
      <Button
        label={doorPayGuestContinueLabel(money(view.totalCents, view.currency))}
        onPress={() => void handleContinue()}
        variant="primary"
        size="lg"
        fullWidth
        loading={submitting}
        disabled={submitting}
        testID="door-pay-continue"
      />
    </View>
  );
};

// ---- B4: paid (no QR; the door has them checked in) ----------------------

const PaidCard: React.FC<{ view: DoorPayCodeView; contact: StoredContact | null }> = ({ view, contact }) => {
  const count = view.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <View style={styles.card} testID="door-pay-youre-in">
      <View style={styles.okRing}>
        <Icon name="check" size={30} color={semantic.success} />
      </View>
      <Text style={styles.title}>You're in</Text>
      <Text style={styles.body}>
        Paid {money(view.totalCents, view.currency)} · {count} ticket{count === 1 ? "" : "s"} · {view.eventName}
      </Text>
      <View style={styles.note}>
        <Text style={styles.body}>
          <Text style={styles.bold}>Walk straight in.</Text> The door has you checked in.
        </Text>
      </View>
      <View style={styles.note}>
        <Text style={styles.body}>
          {contact !== null
            ? `Your tickets and receipt are in Mingla Explorer. Sign in with ${contact.email} or ${contact.phone}.`
            : "Your tickets and receipt are in Mingla Explorer. Sign in with the email or number you paid with."}
        </Text>
      </View>
      <Button
        label="Get Mingla Explorer"
        onPress={() => void Linking.openURL(DOWNLOAD_PAGE_URL)}
        variant="primary"
        size="lg"
        fullWidth
        accessibilityRole="link"
      />
    </View>
  );
};

// ---- Shared state card -----------------------------------------------------

interface StateCardProps {
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
  busy?: boolean;
  /** End states: the same door tones as the host's screen. */
  tone?: DoorPayGuestTone;
}

const StateCard: React.FC<StateCardProps> = ({ title, body, action, onAction, busy, tone }) => (
  <View style={styles.card} accessibilityRole="summary">
    {busy ? <ActivityIndicator color={accent.warm} /> : null}
    {tone !== undefined ? <GuestToneRing tone={tone} /> : null}
    <Text style={styles.title}>{title}</Text>
    {body.length > 0 ? <Text style={styles.body}>{body}</Text> : null}
    {action && onAction ? (
      <Button label={action} onPress={onAction} fullWidth size="md" accessibilityLabel={action} />
    ) : null}
  </View>
);

const GuestToneRing: React.FC<{ tone: DoorPayGuestTone }> = ({ tone }) => {
  const style = DOOR_PAY_GUEST_TONE_STYLES[tone];
  return (
    <View
      style={[
        styles.toneRing,
        { backgroundColor: style.ringFill },
        style.ringBorder !== null ? { borderWidth: 1, borderColor: style.ringBorder } : null,
      ]}
      testID={`door-pay-guest-tone-${tone}`}
    >
      <Icon name={style.defaultIcon} size={style.iconSize} color={style.iconColor} />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: canvas.discover },
  content: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xl,
  },
  wordmark: { marginBottom: spacing.lg },
  wordmarkText: { ...typography.h2, color: textTokens.primary },
  card: {
    width: "100%",
    maxWidth: 480,
    padding: spacing.lg,
    borderRadius: radiusTokens.lg,
    backgroundColor: canvas.profile,
    borderWidth: 1,
    borderColor: glass.border.profileElevated,
    gap: spacing.md,
  },
  title: { ...typography.h2, color: textTokens.primary, textAlign: "center" },
  body: { ...typography.body, color: textTokens.secondary, textAlign: "center" },
  bold: { fontWeight: "700", color: textTokens.primary },
  eyebrow: { fontSize: 11, fontWeight: "700", letterSpacing: 1.2, color: textTokens.tertiary },
  faint: { fontSize: 12, lineHeight: 17, color: textTokens.tertiary },
  basket: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    gap: spacing.xs,
  },
  kv: { flexDirection: "row", justifyContent: "space-between", gap: spacing.sm },
  kvKey: { fontSize: 14, color: textTokens.secondary, flexShrink: 1 },
  kvValue: { fontSize: 14, color: textTokens.primary, fontVariant: ["tabular-nums"] },
  kvStrong: { fontSize: 15, fontWeight: "700", color: textTokens.primary, fontVariant: ["tabular-nums"] },
  field: { gap: 6 },
  fieldLabel: { fontSize: 13, fontWeight: "600", color: textTokens.secondary },
  errorText: { fontSize: 13, lineHeight: 18, color: semantic.errorText },
  checkboxRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, minHeight: 44 },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: textTokens.tertiary,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxBoxChecked: { backgroundColor: accent.warm, borderColor: accent.warm },
  checkboxLabel: { flex: 1, fontSize: 13, lineHeight: 19, color: textTokens.secondary },
  link: { textDecorationLine: "underline", color: textTokens.primary },
  note: {
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  toneRing: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
  },
  okRing: {
    width: 64,
    height: 64,
    borderRadius: 999,
    alignSelf: "center",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: semantic.successTint,
  },
});
