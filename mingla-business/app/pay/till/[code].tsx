/**
 * /pay/till/[code] — the guest's Scan to pay page (#4490 spec 08 O2).
 *
 * The guest scanned the Till's code with their own phone camera. Anonymous on
 * purpose (the `/pay/` prefix is a public buyer route; no auth hook): the
 * short-lived code for one payment is the credential. The bill is locked to
 * what the server priced; the guest gives their name, email and mobile (with
 * autofill) and is handed to the provider's page (Paystack: card, bank
 * transfer, USSD; Stripe: hosted page on the venue's account). The `/pay/door`
 * layout, tones and bounded polling are reused.
 *
 * Back with `?paid=1`, the page asks the server to confirm with the provider
 * (confirm on return) a bounded number of times. A bank transfer can take a
 * few minutes: the page says so and never claims no money moved on a
 * closed code alone (the door rule).
 */

import React, { useCallback, useEffect, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Head from "expo-router/head";
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
} from "../../../src/constants/purchaseTermsDisclosure";
import { PURCHASE_TERMS_URL } from "../../../src/constants/purchaseTermsDisclosure";
import { recordConsent } from "../../../src/services/consentService";
import {
  confirmTillPayCode,
  payTillPayCode,
  TillPayCodeError,
  viewTillPayCode,
} from "../../../src/services/tillPayCodeService";
import {
  GUEST_PAY_POLL_MS,
  GUEST_PAY_POLLS,
  guestPayFormErrors,
  guestPayState,
  type TillPayView,
} from "../../../src/components/venue/till/tillGuestPayModel";
import { tillErrorCopy } from "../../../src/components/venue/till/tillErrorCopy";
import { formatCurrency } from "../../../src/utils/currency";
import { phoneStartCountryForCurrency } from "../../../src/utils/phoneStartCountryForCurrency";

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] : value) ?? "";
const normalizeCode = (raw: string): string => raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
const money = (minor: number, currency: string): string => formatCurrency(minor, currency, true);

const assignLocation = (url: string): boolean => {
  const w = globalThis as unknown as { location?: { assign?: (u: string) => void } };
  if (typeof w.location?.assign !== "function") return false;
  w.location.assign(url);
  return true;
};

export default function TillPayGuestPage(): React.ReactElement {
  const params = useLocalSearchParams<{ code?: string | string[]; paid?: string | string[] }>();
  const code = normalizeCode(first(params.code));
  const returned = first(params.paid) === "1";
  const [view, setView] = useState<TillPayView | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState(false);
  const [pollsLeft, setPollsLeft] = useState(returned ? GUEST_PAY_POLLS : 0);
  const [round, setRound] = useState(0);
  const { isWideDesktop } = useResponsiveLayout();

  const load = useCallback(async (): Promise<void> => {
    setError(false);
    try {
      setView(await viewTillPayCode(code));
    } catch (err) {
      if (err instanceof TillPayCodeError && (err.status === 404 || err.code === "pay_code_not_found")) setNotFound(true);
      else setError(true);
    }
  }, [code]);

  // Back from the provider: ask the server to confirm, a bounded number of times.
  useEffect(() => {
    if (!returned) {
      void load();
      return undefined;
    }
    let cancelled = false;
    const run = async (): Promise<void> => {
      for (let left = GUEST_PAY_POLLS; left > 0 && !cancelled; left -= 1) {
        try {
          const r = await confirmTillPayCode(code);
          if (cancelled) return;
          setView(r.view);
          if (r.view.paid || r.result === "confirmed") {
            setPollsLeft(0);
            return;
          }
        } catch (err) {
          if (err instanceof TillPayCodeError && err.code === "pay_code_not_found") {
            setNotFound(true);
            return;
          }
        }
        setPollsLeft(left - 1);
        await new Promise<void>((resolve) => setTimeout(resolve, GUEST_PAY_POLL_MS));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [code, returned, load, round]);

  const state = guestPayState({ loading: view === null && !error && !notFound, notFound, error, view, returned, pollsLeft });

  let content: React.ReactNode;
  if (state === "loading") {
    content = <StateCard title="Loading…" body="" busy />;
  } else if (state === "not_found") {
    content = <StateCard title="This code isn't valid" body="Check the code with the staff, or ask them to show a new one." />;
  } else if (state === "error") {
    content = (
      <StateCard title="We couldn't load this payment" body="Check your connection and try again." action="Try again" onAction={() => void load()} />
    );
  } else if (state === "confirming") {
    content = (
      <StateCard
        title="Checking your payment…"
        body="Please keep this page open while we confirm it. A bank transfer can take a few minutes."
        busy
      />
    );
  } else if (state === "paid" && view !== null) {
    content = (
      <StateCard
        tone="ok"
        title="Paid"
        body={`Paid ${money(view.amountMinor, view.currency)} at ${view.venueName}. Show this screen to the staff if they ask.`}
      />
    );
  } else if (state === "closed") {
    content = returned ? (
      <StateCard
        title="We're still confirming your payment"
        body="If you paid by bank transfer, it can take a few minutes. You won't be charged twice. The venue sees your payment as soon as it lands."
        action="Check again"
        onAction={() => {
          setPollsLeft(GUEST_PAY_POLLS);
          setRound((r) => r + 1);
        }}
      />
    ) : (
      <StateCard
        tone="muted"
        title="This code is closed"
        body="Ask the staff for a new code. If you already paid on it, the venue sees your payment and will sort it out with you."
      />
    );
  } else if (view !== null) {
    content = <PayForm code={code} view={view} />;
  }

  return (
    <SafeScreen edges={["top", "bottom"]} style={styles.screen}>
      {Platform.OS === "web" ? (
        <Head>
          <title>Pay your bill · Mingla</title>
          <meta name="robots" content="noindex, nofollow" />
        </Head>
      ) : null}
      <WideContext.Provider value={isWideDesktop}>
        <ScrollView style={styles.screen} contentContainerStyle={isWideDesktop ? styles.contentWide : styles.content} keyboardShouldPersistTaps="handled">
          <View style={isWideDesktop ? styles.pageWide : styles.page} testID="till-pay-guest-page">
            <View style={isWideDesktop ? styles.wordmarkWide : styles.wordmark}>
              <GuestPayWordmark />
            </View>
            {isWideDesktop && view !== null && state === "details" ? (
              <View style={styles.statusGrid}>
                <View style={styles.statusMain}>{content}</View>
                <View style={styles.statusAside}>
                  <BillCard view={view} />
                </View>
              </View>
            ) : (
              content
            )}
          </View>
        </ScrollView>
      </WideContext.Provider>
    </SafeScreen>
  );
}

const WideContext = React.createContext<boolean>(false);

const billItems = (view: TillPayView): KeyValueItem[] => [
  ...view.lines.map((line, i) => ({
    key: `line-${i}`,
    label: line.quantity > 1 ? `${line.quantity}× ${line.name}` : line.name,
    value: money(line.amountMinor, view.currency),
  })),
  ...(view.serviceChargeMinor > 0 ? [{ key: "sc", label: "Service charge", value: money(view.serviceChargeMinor, view.currency) }] : []),
  ...(view.paidBeforeMinor > 0 ? [{ key: "before", label: "Paid before", value: `−${money(view.paidBeforeMinor, view.currency)}` }] : []),
  ...(view.tipMinor > 0 ? [{ key: "tip", label: "Tip", value: money(view.tipMinor, view.currency) }] : []),
  ...(view.feesMinor > 0 ? [{ key: "fees", label: "Fees", value: money(view.feesMinor, view.currency) }] : []),
  { key: "total", label: "To pay", value: money(view.amountMinor, view.currency), total: true },
];

const BillCard: React.FC<{ view: TillPayView }> = ({ view }) => (
  <GlassCard padding={space[5]} contentStyle={styles.summaryContent} testID="till-pay-guest-bill">
    <Text style={styles.eyebrow} accessibilityRole="header">
      {view.venueName.trim().length > 0 ? `YOUR BILL · ${view.venueName.trim().toUpperCase()}` : "YOUR BILL"}
    </Text>
    <KeyValue items={billItems(view)} />
  </GlassCard>
);

const PayForm: React.FC<{ code: string; view: TillPayView }> = ({ code, view }) => {
  const wide = React.useContext(WideContext);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const phone = usePhoneEntry({ startCountries: [phoneStartCountryForCurrency(view.currency)] });
  const errors = guestPayFormErrors({ name, email });
  const valid = errors.name === null && errors.email === null && phone.e164 !== null;

  const pay = async (): Promise<void> => {
    setShowErrors(true);
    if (!valid || phone.e164 === null) return;
    if (!termsAccepted) {
      setSubmitError("Please agree to the terms to continue.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const consent = await recordConsent({
        source: "checkout",
        disclosureText: PURCHASE_TERMS_DISCLOSURE_TEXT,
        disclosureVersion: PURCHASE_TERMS_DISCLOSURE_VERSION,
        scopes: ["transactional"],
        phone: phone.e164,
        email: email.trim().toLowerCase(),
        countryCode: phone.countryIso,
        userId: null,
        eventId: null,
      });
      if (!consent.ok) console.error("[till-pay] consent_records write failed (proceeding; checkbox act stands)");
      const handoff = await payTillPayCode({
        code,
        buyer: { name: name.trim(), email: email.trim().toLowerCase(), phone: phone.e164, phoneCountryIso: phone.countryIso },
      });
      if (assignLocation(handoff.redirectUrl)) return;
      setSubmitError("Couldn't open the payment page. Try again.");
    } catch (err) {
      setSubmitError(tillErrorCopy(err instanceof TillPayCodeError ? err.code : "till_failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const fields = (
    <View style={styles.formContent} testID="till-pay-form">
      <Text style={styles.faint}>All three are needed for your receipt.</Text>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Full name</Text>
        <Input value={name} onChangeText={setName} variant="text" placeholder="Full name" autoComplete="name" textContentType="name" accessibilityLabel="Full name, required" />
        {showErrors && errors.name !== null ? <Text style={styles.errorText}>{errors.name}</Text> : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Email</Text>
        <Input value={email} onChangeText={setEmail} variant="email" placeholder="Email" autoComplete="email" textContentType="emailAddress" accessibilityLabel="Email address, required" />
        {showErrors && errors.email !== null ? <Text style={styles.errorText}>{errors.email}</Text> : null}
      </View>
      <View style={styles.field}>
        <Text style={styles.fieldLabel}>Mobile number</Text>
        <PhoneField entry={phone} required showErrors={showErrors} accessibilityLabel="Mobile number" placeholder="Mobile number" testID="till-pay-buyer-phone" />
      </View>
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
          <Text style={styles.link} onPress={() => void Linking.openURL(PURCHASE_TERMS_URL)} accessibilityRole="link">{PURCHASE_TERMS_LABEL_TERMS}</Text>
          {PURCHASE_TERMS_LABEL_JOINER}
          <Text style={styles.link} onPress={() => void Linking.openURL(PURCHASE_PRIVACY_URL)} accessibilityRole="link">{PURCHASE_TERMS_LABEL_PRIVACY}</Text>
          {PURCHASE_TERMS_LABEL_SUFFIX}
        </Text>
      </Pressable>
      {submitError !== null ? <Text style={styles.errorText} accessibilityRole="alert">{submitError}</Text> : null}
      <Button
        label={`Pay ${money(view.amountMinor, view.currency)}`}
        onPress={() => void pay()}
        variant="primary"
        size="lg"
        fullWidth
        loading={submitting}
        disabled={submitting}
        testID="till-pay-continue"
      />
    </View>
  );
  if (wide) {
    return <GlassCard padding={space[6]} contentStyle={styles.formContent}>{fields}</GlassCard>;
  }
  return (
    <View style={styles.phoneStack}>
      <BillCard view={view} />
      {fields}
    </View>
  );
};

const StateCard: React.FC<{ title: string; body: string; action?: string; onAction?: () => void; busy?: boolean; tone?: "ok" | "muted" }> = ({
  title,
  body,
  action,
  onAction,
  busy,
  tone,
}) => {
  const wide = React.useContext(WideContext);
  return (
    <View accessibilityRole="summary" style={styles.statusPaneHost}>
      <GlassCard padding={wide ? space[8] : space[6]} contentStyle={wide ? styles.statusContentWide : styles.statusContent}>
        {busy ? <Spinner size={36} /> : null}
        {tone !== undefined ? (
          <View style={[styles.toneTile, tone === "ok" ? styles.toneOk : styles.toneMuted]} testID={`till-pay-guest-tone-${tone}`}>
            <Icon name={tone === "ok" ? "check" : "clock"} size={26} color={tone === "ok" ? color.success : color.text2} />
          </View>
        ) : null}
        <View style={[styles.statusText, wide ? styles.statusTextWide : null]}>
          <Text style={[styles.title, wide ? styles.titleWide : null]}>{title}</Text>
          {body.length > 0 ? <Text style={[styles.body, wide ? styles.bodyWide : null]}>{body}</Text> : null}
        </View>
        {action && onAction ? <Button label={action} onPress={onAction} fullWidth size="md" accessibilityLabel={action} /> : null}
      </GlassCard>
    </View>
  );
};

/** Kit `.tpl-status .status-card { min-height: 380px }` and its summary column. */
const STATUS_CARD_MIN_HEIGHT = 380;
const STATUS_SUMMARY_WIDTH = 380;
const PHONE_COLUMN_MAX = 480;
const TONE_TILE = 56;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.canvas },
  content: { flexGrow: 1, alignItems: "center", paddingHorizontal: space[4], paddingTop: space[4], paddingBottom: space[8] },
  contentWide: { flexGrow: 1, alignItems: "center", paddingHorizontal: space[6], paddingTop: space[6], paddingBottom: space[9] },
  page: { width: "100%", maxWidth: PHONE_COLUMN_MAX },
  pageWide: { width: "100%", maxWidth: DESKTOP_TEMPLATE_MAX_WIDTH.status },
  wordmark: { alignItems: "center", paddingVertical: space[3], marginBottom: space[4] },
  wordmarkWide: { alignItems: "flex-start", marginBottom: space[7] },
  statusGrid: { flexDirection: "row", alignItems: "flex-start", gap: space[6] },
  statusMain: { flex: 1, minWidth: 0 },
  statusAside: { width: STATUS_SUMMARY_WIDTH, flexShrink: 0 },
  summaryContent: { gap: space[4] },
  phoneStack: { gap: space[6] },
  formContent: { gap: space[4] },
  statusPaneHost: { width: "100%" },
  statusContent: { alignItems: "center", gap: space[4] },
  statusContentWide: { minHeight: STATUS_CARD_MIN_HEIGHT, justifyContent: "center", alignItems: "flex-start", gap: space[4] },
  statusText: { alignSelf: "stretch", gap: space[2] },
  statusTextWide: { maxWidth: 520 },
  title: { ...type.h1, color: color.text1, textAlign: "center" },
  titleWide: { textAlign: "left" },
  body: { ...type.body, color: color.text2, textAlign: "center" },
  bodyWide: { ...type.small, textAlign: "left" },
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
  toneTile: { width: TONE_TILE, height: TONE_TILE, borderRadius: radius.sm, alignItems: "center", justifyContent: "center" },
  toneOk: { backgroundColor: color.fill.inset, borderWidth: 1, borderColor: color.success },
  toneMuted: { backgroundColor: color.fill.inset },
});
