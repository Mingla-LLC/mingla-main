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
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams } from "expo-router";

import { GuestPayWordmark } from "../../../src/components/brand/GuestPayWordmark";
import { Button } from "../../../src/components/ui/Button";
import { DESKTOP_TEMPLATE_MAX_WIDTH } from "../../../src/components/ui/DesktopCanvas";
import { GlassCard } from "../../../src/components/ui/GlassCard";
import { Icon } from "../../../src/components/ui/Icon";
import { Input } from "../../../src/components/ui/Input";
import { KeyValue, type KeyValueItem } from "../../../src/components/ui/KeyValue";
import { PhoneField, usePhoneEntry } from "../../../src/components/ui/PhoneField";
import { SafeScreen } from "../../../src/components/ui/SafeScreen";
import { Spinner } from "../../../src/components/ui/Spinner";
import { color, radius, space, type } from "../../../src/constants/designSystem";
import { useResponsiveLayout } from "../../../src/hooks/useResponsiveLayout";
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
} from "../../../src/constants/purchaseTermsDisclosure";
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
  const { isWideDesktop } = useResponsiveLayout();

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

  // #4420 Public status template (spec §3.6): on wide web the status sits left
  // and the locked basket sits in a 380 summary on the right, inside a 1040
  // column. On a phone the basket stays on top of the form only.
  const summaryView: DoorPayCodeView | null =
    page.kind === "ready" || page.kind === "paid" ? page.view : page.kind === "pending" ? page.view : null;

  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.screen}>
      <GuestLayoutContext.Provider value={isWideDesktop}>
        <ScrollView
          style={styles.screen}
          contentContainerStyle={isWideDesktop ? styles.contentWide : styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <View style={isWideDesktop ? styles.pageWide : styles.page} testID="door-pay-guest-page">
            <View style={isWideDesktop ? styles.wordmarkWide : styles.wordmark}>
              <GuestPayWordmark />
            </View>
            {isWideDesktop ? (
              <View style={styles.statusGrid} testID="door-pay-guest-status-template">
                <View style={styles.statusMain}>{content}</View>
                {summaryView !== null ? (
                  <View style={styles.statusAside}>
                    <BasketSummary view={summaryView} />
                  </View>
                ) : null}
              </View>
            ) : (
              content
            )}
          </View>
        </ScrollView>
      </GuestLayoutContext.Provider>
    </SafeScreen>
  );
}

/** True on wide web (>= 1024): the Public status template's two columns. */
const GuestLayoutContext = React.createContext<boolean>(false);
const useWideGuestLayout = (): boolean => React.useContext(GuestLayoutContext);

const basketItems = (view: DoorPayCodeView): KeyValueItem[] => [
  ...view.lines.map((line) => ({
    key: line.ticketTypeId,
    label: `${line.quantity}× ${line.name}`,
    value: money(line.unitCents * line.quantity, view.currency),
  })),
  ...(view.feeCents > 0 ? [{ key: "fees", label: "Fees", value: money(view.feeCents, view.currency) }] : []),
  { key: "total", label: "Total", value: money(view.totalCents, view.currency), total: true },
];

/** The locked basket (wide web): the template's 380 summary column. */
const BasketSummary: React.FC<{ view: DoorPayCodeView }> = ({ view }) => {
  const eventName = typeof view.eventName === "string" ? view.eventName.trim() : "";
  return (
    <GlassCard padding={space[6]} contentStyle={styles.summaryContent} testID="door-pay-guest-summary">
      <View style={styles.summaryHead}>
        <Text style={styles.eyebrow} accessibilityRole="header">
          {doorPayGuestEyebrow(null)}
        </Text>
        {eventName.length > 0 ? <Text style={styles.summaryTitle}>{eventName}</Text> : null}
      </View>
      <KeyValue items={basketItems(view)} />
    </GlassCard>
  );
};

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
    <PayFormFrame view={view}>
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
          {termsAccepted ? <Icon name="check" size={14} color={color.ink} /> : null}
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
    </PayFormFrame>
  );
};

/**
 * #4420 — the form's frame. Wide web: one pane holding the fields (the basket
 * is the template's summary column). Phone: the basket pane on top, the
 * fields on the canvas under it.
 */
const PayFormFrame: React.FC<{ view: DoorPayCodeView; children: React.ReactNode }> = ({ view, children }) => {
  const wide = useWideGuestLayout();
  if (wide) {
    return (
      <GlassCard padding={space[6]} contentStyle={styles.formContent} testID="door-pay-form">
        {children}
      </GlassCard>
    );
  }
  return (
    <View style={styles.phoneStack} testID="door-pay-form">
      <GlassCard padding={space[5]} contentStyle={styles.summaryContent} testID="door-pay-guest-basket">
        <Text style={styles.eyebrow} accessibilityRole="header">
          {doorPayGuestEyebrow(view.eventName)}
        </Text>
        <KeyValue items={basketItems(view)} />
      </GlassCard>
      <View style={styles.formContent}>{children}</View>
    </View>
  );
};

// ---- B4: paid (no QR; the door has them checked in) ----------------------

const PaidCard: React.FC<{ view: DoorPayCodeView; contact: StoredContact | null }> = ({ view, contact }) => {
  const wide = useWideGuestLayout();
  const count = view.lines.reduce((sum, line) => sum + line.quantity, 0);
  return (
    <StatusPane testID="door-pay-youre-in">
      <GuestToneTile tone="ok" />
      <View style={[styles.statusText, wide ? styles.statusTextWide : null]}>
        <Text style={[styles.title, wide ? styles.titleWide : null]}>You're in</Text>
        <Text style={[styles.body, wide ? styles.bodyWide : null]}>
          Paid {money(view.totalCents, view.currency)} · {count} ticket{count === 1 ? "" : "s"} · {view.eventName}
        </Text>
      </View>
      <View style={styles.note}>
        <Text style={styles.noteText}>
          <Text style={styles.bold}>Walk straight in.</Text> The door has you checked in.
        </Text>
      </View>
      <View style={styles.note}>
        <Text style={styles.noteText}>
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
    </StatusPane>
  );
};

// ---- Shared state card -----------------------------------------------------

/**
 * #4420 Public status card. Wide web: a 380-tall pane, content left and
 * vertically centred (kit `.tpl-status .status-card.left`). Phone: the pane
 * with its content centred.
 */
const StatusPane: React.FC<{ children: React.ReactNode; testID?: string; summary?: boolean }> = ({
  children,
  testID,
  summary = false,
}) => {
  const wide = useWideGuestLayout();
  return (
    <View accessibilityRole={summary ? "summary" : undefined} style={styles.statusPaneHost} testID={testID}>
      <GlassCard
        padding={wide ? space[8] : space[6]}
        contentStyle={wide ? styles.statusContentWide : styles.statusContent}
      >
        {children}
      </GlassCard>
    </View>
  );
};

interface StateCardProps {
  title: string;
  body: string;
  action?: string;
  onAction?: () => void;
  busy?: boolean;
  /** End states: the same door tones as the host's screen. */
  tone?: DoorPayGuestTone;
}

const StateCard: React.FC<StateCardProps> = ({ title, body, action, onAction, busy, tone }) => {
  const wide = useWideGuestLayout();
  return (
    <StatusPane summary>
      {busy ? <Spinner size={36} /> : null}
      {tone !== undefined ? <GuestToneTile tone={tone} /> : null}
      <View style={[styles.statusText, wide ? styles.statusTextWide : null]}>
        <Text style={[styles.title, wide ? styles.titleWide : null]}>{title}</Text>
        {body.length > 0 ? <Text style={[styles.body, wide ? styles.bodyWide : null]}>{body}</Text> : null}
      </View>
      {action && onAction ? (
        <Button
          label={action}
          onPress={onAction}
          fullWidth
          size="md"
          accessibilityLabel={action}
        />
      ) : null}
    </StatusPane>
  );
};

/** The end-state icon tile in the door tones (paid green, closed grey, failed red). */
const GuestToneTile: React.FC<{ tone: DoorPayGuestTone }> = ({ tone }) => {
  const style = DOOR_PAY_GUEST_TONE_STYLES[tone];
  return (
    <View
      style={[
        styles.toneTile,
        { backgroundColor: style.ringFill },
        style.ringBorder !== null ? { borderWidth: 1, borderColor: style.ringBorder } : null,
      ]}
      testID={`door-pay-guest-tone-${tone}`}
    >
      <Icon name={style.defaultIcon} size={style.iconSize - 6} color={style.iconColor} />
    </View>
  );
};

/** Kit `.tpl-status .status-card { min-height: 380px }`. */
const STATUS_CARD_MIN_HEIGHT = 380;
/** Kit `.tpl-status` summary column. */
const STATUS_SUMMARY_WIDTH = 380;
/** Phone column: one readable measure, centred. */
const PHONE_COLUMN_MAX = 480;
const TONE_TILE = 56;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  content: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: space[4],
    paddingTop: space[4],
    paddingBottom: space[8],
  },
  contentWide: {
    flexGrow: 1,
    alignItems: "center",
    paddingHorizontal: space[6],
    paddingTop: space[6],
    paddingBottom: space[9],
  },
  page: { width: "100%", maxWidth: PHONE_COLUMN_MAX },
  pageWide: { width: "100%", maxWidth: DESKTOP_TEMPLATE_MAX_WIDTH.status },
  wordmark: { alignItems: "center", paddingVertical: space[3], marginBottom: space[4] },
  wordmarkWide: { alignItems: "flex-start", marginBottom: space[7] },
  statusGrid: { flexDirection: "row", alignItems: "flex-start", gap: space[6] },
  statusMain: { flex: 1, minWidth: 0 },
  statusAside: { width: STATUS_SUMMARY_WIDTH, flexShrink: 0 },
  summaryContent: { gap: space[4] },
  summaryHead: { gap: space[1] },
  summaryTitle: { ...type.h2, color: color.text1 },
  phoneStack: { gap: space[6] },
  formContent: { gap: space[4] },
  statusPaneHost: { width: "100%" },
  statusContent: { alignItems: "center", gap: space[4] },
  statusContentWide: {
    minHeight: STATUS_CARD_MIN_HEIGHT,
    justifyContent: "center",
    alignItems: "flex-start",
    gap: space[4],
  },
  statusText: { alignSelf: "stretch", gap: space[2] },
  statusTextWide: { maxWidth: 520 },
  title: { ...type.h1, color: color.text1, textAlign: "center" },
  titleWide: { textAlign: "left" },
  body: { ...type.body, color: color.text2, textAlign: "center" },
  bodyWide: { ...type.small, textAlign: "left" },
  bold: { fontWeight: type.row.fontWeight, color: color.text1 },
  eyebrow: { ...type.label, textTransform: "uppercase", color: color.text3 },
  faint: { ...type.caption, color: color.text3 },
  field: { gap: space[2] },
  fieldLabel: { ...type.caption, color: color.text2 },
  errorText: { ...type.caption, color: color.errorText },
  checkboxRow: { flexDirection: "row", alignItems: "flex-start", gap: space[3], minHeight: 44 },
  checkboxBox: {
    width: 22,
    height: 22,
    borderRadius: radius.xs,
    borderWidth: 1.5,
    borderColor: color.lineStrong,
    backgroundColor: color.fill.input,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 1,
  },
  checkboxBoxChecked: { backgroundColor: color.paper, borderColor: color.paper },
  checkboxLabel: { ...type.small, flex: 1, color: color.text2 },
  link: { textDecorationLine: "underline", color: color.text1 },
  note: {
    alignSelf: "stretch",
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: color.line,
    backgroundColor: color.fill.inset,
  },
  noteText: { ...type.small, color: color.text2 },
  toneTile: {
    width: TONE_TILE,
    height: TONE_TILE,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});
