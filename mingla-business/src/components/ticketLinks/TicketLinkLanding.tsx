import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";

import {
  accent,
  glass,
  radius,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import {
  PURCHASE_PRIVACY_URL,
  PURCHASE_TERMS_URL,
} from "../../constants/consentDisclosure";
import { checkoutPublicPathWithSeed } from "../../constants/publicUrls";
import { formatCurrency } from "../../utils/currency";
import { randomUuid } from "../../utils/randomId";
import { supabase } from "../../services/supabase";
import type { TicketLinkResolve, TicketLinkState } from "../../services/ticketLinkPublicTypes";
import { Button } from "../ui/Button";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { PhoneField, usePhoneEntry } from "../ui/PhoneField";

type PersonDraft = { id: string; name: string; email: string; phone: string };

const emptyPerson = (): PersonDraft => ({
  id: randomUuid(),
  name: "",
  email: "",
  phone: "",
});

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const publicLinkErrorCopy = (code: string): string => {
  switch (code) {
    case "event_date_choice_required": return "Choose an event date before joining the guest list.";
    case "invalid_request": return "Check the details for every person and try again.";
    case "rate_limited": return "Too many attempts. Wait a moment and try again.";
    case "link_revoked": return "This link was revoked.";
    case "link_full": return "This link has no places left.";
    case "ticket_capacity_exceeded": return "There aren’t enough event places left for this group.";
    default: return "Something went wrong. Try again.";
  }
};

const invokePublic = async <T,>(body: Record<string, unknown>): Promise<T> => {
  const { data, error } = await supabase.functions.invoke("ticket-link-public", { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    try {
      const payload = JSON.parse(await context?.text?.() ?? "{}") as { code?: string };
      throw new Error(publicLinkErrorCopy(payload.code ?? "internal"));
    } catch (cause) {
      if (cause instanceof Error && cause.message !== "Unexpected end of JSON input") throw cause;
      throw new Error(publicLinkErrorCopy("internal"));
    }
  }
  return data as T;
};

const resolveTicketLink = (token: string): Promise<TicketLinkResolve> =>
  invokePublic({ op: "resolve", token });

const signupTicketLink = (input: {
  token: string;
  lead: { name: string; email: string; phone: string };
  guests: Array<{ name: string; email: string; phone: string }>;
  eventDateId: string | null;
  clientRequestId: string;
  website: string;
}): Promise<{ status: "issued" | "pending"; alreadyPending?: boolean; people: Array<{ name: string; maskedEmail: string }> }> =>
  invokePublic({ op: "signup", ...input });

function PersonFields({
  person,
  label,
  showErrors,
  onChange,
  onRemove,
}: {
  person: PersonDraft;
  label: string;
  showErrors: boolean;
  onChange: (person: PersonDraft) => void;
  onRemove?: () => void;
}): React.ReactElement {
  const phone = usePhoneEntry({ startCountries: ["US", "GB", "NG"] });
  useEffect(() => {
    onChange({ ...person, phone: phone.e164 ?? "" });
    // The parent callback and person object intentionally do not drive this
    // field; the phone entry is the source of truth while mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone.e164]);
  const nameError = showErrors && person.name.trim().length === 0
    ? "Enter a name."
    : null;
  const emailError = showErrors && !EMAIL.test(person.email.trim())
    ? "Enter a valid email."
    : null;
  return (
    <View style={styles.personCard}>
      <View style={styles.personHeading}>
        <Text style={styles.personLabel}>{label}</Text>
        {onRemove ? (
          <Pressable
            onPress={onRemove}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${label}`}
            hitSlop={8}
          >
            <Icon name="close" size={18} color={textTokens.tertiary} />
          </Pressable>
        ) : null}
      </View>
      <Input
        value={person.name}
        onChangeText={(name) => onChange({ ...person, name })}
        placeholder="Full name"
        accessibilityLabel={`${label} full name`}
        error={nameError}
      />
      <Input
        value={person.email}
        onChangeText={(email) => onChange({ ...person, email })}
        variant="email"
        placeholder="Email"
        accessibilityLabel={`${label} email`}
        error={emailError}
      />
      <PhoneField
        entry={phone}
        accessibilityLabel={`${label} phone number`}
        required
        showErrors={showErrors}
        testID={`ticket-link-phone-${person.id}`}
      />
    </View>
  );
}

const stateCopy = (state: TicketLinkState): { title: string; body: string } => {
  switch (state) {
    case "full":
    case "sold_out":
      return { title: "This link is full", body: "All places available through this link have been taken." };
    case "expired":
      return { title: "This link has expired", body: "Ask the host for a fresh invitation." };
    case "revoked":
      return { title: "This link is no longer active", body: "Ask the host if you still need access." };
    case "event_ended":
      return { title: "This event has ended", body: "This invitation can no longer be used." };
    case "event_unavailable":
    case "tier_unavailable":
      return { title: "This invitation is unavailable", body: "The host may have paused or changed it." };
    default:
      return { title: "Invitation not found", body: "Check that you copied the full link, or ask the host for a new one." };
  }
};

const dateLabel = (startAt: string | null, timezone: string | undefined): string => {
  if (!startAt) return "Date to be announced";
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(startAt));
  } catch {
    return new Date(startAt).toLocaleString();
  }
};

export default function TicketLinkLanding(): React.ReactElement {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const [resolved, setResolved] = useState<TicketLinkResolve | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lead, setLead] = useState<PersonDraft>(emptyPerson);
  const [guests, setGuests] = useState<PersonDraft[]>([]);
  const [eventDateId, setEventDateId] = useState<string | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<"issued" | "pending" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    resolveTicketLink(token)
      .then((value) => {
        if (cancelled) return;
        setResolved(value);
        setEventDateId(value.eventDateId ?? null);
        if (value.state === "active" && value.kind === "private_ticket" && value.eventId) {
          try {
            globalThis.sessionStorage?.setItem(`mingla.ticketLink.${value.eventId}`, token);
          } catch {
            // Browser storage is a convenience; the route parameter remains authoritative.
          }
        }
      })
      .catch(() => {
        if (!cancelled) setResolved({ state: "not_found" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [token]);

  const people = useMemo(() => [lead, ...guests], [lead, guests]);
  const needsDateChoice = (resolved?.dates?.length ?? 0) > 0;
  const valid = (!needsDateChoice || eventDateId !== null) && people.every(
    (person) =>
      person.name.trim().length > 0 &&
      EMAIL.test(person.email.trim()) &&
      /^\+[1-9][0-9]{1,14}$/.test(person.phone),
  ) && new Set(people.map((person) => person.email.trim().toLowerCase())).size === people.length;

  const submit = useCallback(async (): Promise<void> => {
    setShowErrors(true);
    setError(null);
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const answer = await signupTicketLink({
        token,
        lead: { name: lead.name.trim(), email: lead.email.trim(), phone: lead.phone },
        guests: guests.map((guest) => ({
          name: guest.name.trim(),
          email: guest.email.trim(),
          phone: guest.phone,
        })),
        eventDateId,
        clientRequestId: randomUuid(),
        website: "",
      });
      setOutcome(answer.status);
    } catch (cause) {
      setError(
        typeof (cause as { message?: unknown })?.message === "string"
          ? (cause as Error).message
          : publicLinkErrorCopy("internal"),
      );
    } finally {
      setSubmitting(false);
    }
  }, [eventDateId, guests, lead, submitting, token, valid]);

  if (loading) {
    return <View style={styles.center}><ActivityIndicator color={accent.warm} /></View>;
  }
  if (!resolved || resolved.state !== "active" || !resolved.event || !resolved.tier) {
    const copy = stateCopy(resolved?.state ?? "not_found");
    return (
      <View style={styles.center}>
        <View style={styles.stateIcon}><Icon name="ticket" size={28} color={accent.warm} /></View>
        <Text style={styles.stateTitle}>{copy.title}</Text>
        <Text style={styles.stateBody}>{copy.body}</Text>
      </View>
    );
  }

  if (outcome !== null) {
    const pending = outcome === "pending";
    return (
      <View style={styles.center}>
        <View style={styles.stateIcon}>
          <Icon name={pending ? "clock" : "check"} size={28} color={accent.warm} />
        </View>
        <Text style={styles.stateTitle}>{pending ? "Request sent" : "You're on the list"}</Text>
        <Text style={styles.stateBody}>
          {pending
            ? "The host will review your group. No places are held until they approve it."
            : "Each person will receive their own Mingla pass by email."}
        </Text>
      </View>
    );
  }

  const { event, tier } = resolved;
  if (resolved.kind === "private_ticket") {
    const continueToCheckout = (): void => {
      if (!resolved.eventId) return;
      const path = checkoutPublicPathWithSeed(resolved.eventId, { [tier.id]: 1 }, eventDateId ? [eventDateId] : null);
      router.push(`${path}${path.includes("?") ? "&" : "?"}ticketLink=${encodeURIComponent(token)}` as never);
    };
    return (
      <ScrollView style={styles.host} contentContainerStyle={styles.content}>
        <EventCard resolved={resolved} />
        <View style={styles.ticketCard}>
          <Text style={styles.eyebrow}>PRIVATE TICKET</Text>
          <Text style={styles.ticketName}>{tier.name}</Text>
          {tier.description ? <Text style={styles.body}>{tier.description}</Text> : null}
          <Text style={styles.price}>
            {(tier.allInCents ?? tier.priceCents ?? 0) === 0
              ? "Free"
              : formatCurrency((tier.allInCents ?? tier.priceCents ?? 0) / 100, tier.currency ?? event.currency)}
          </Text>
        </View>
        <Button label="Continue to checkout" onPress={continueToCheckout} fullWidth size="lg" />
        <Legal />
      </ScrollView>
    );
  }

  const maxGuests = resolved.guestsMax ?? 0;
  return (
    <ScrollView style={styles.host} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <EventCard resolved={resolved} />
      <Text style={styles.heading}>Join the guest list</Text>
      <Text style={styles.body}>
        Add contact details for everyone coming. Each guest receives their own pass.
      </Text>
      {resolved.dates && resolved.dates.length > 0 ? (
        <View style={styles.dates}>
          <Text style={styles.personLabel}>Choose a date</Text>
          {resolved.dates.map((date) => (
            <Pressable
              key={date.id}
              onPress={() => setEventDateId(date.id)}
              style={[styles.dateRow, eventDateId === date.id && styles.dateRowActive]}
            >
              <Text style={styles.dateText}>{dateLabel(date.startAt, date.timezone)}</Text>
              {eventDateId === date.id ? <Icon name="check" size={18} color={accent.warm} /> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
      <PersonFields person={lead} label="Your details" showErrors={showErrors} onChange={setLead} />
      {guests.map((guest, index) => (
        <PersonFields
          key={guest.id}
          person={guest}
          label={`Guest ${index + 1}`}
          showErrors={showErrors}
          onChange={(next) => setGuests((current) => current.map((item) => item.id === next.id ? next : item))}
          onRemove={() => setGuests((current) => current.filter((item) => item.id !== guest.id))}
        />
      ))}
      {guests.length < maxGuests ? (
        <Button
          label="Add a guest"
          onPress={() => setGuests((current) => [...current, emptyPerson()])}
          variant="secondary"
          fullWidth
        />
      ) : null}
      {showErrors && needsDateChoice && eventDateId === null ? (
        <Text style={styles.error}>Choose an event date.</Text>
      ) : null}
      {showErrors && !valid && (!needsDateChoice || eventDateId !== null) ? (
        <Text style={styles.error}>Complete every field with a valid phone number and a different email for each person.</Text>
      ) : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label={resolved.approvalRequired ? "Request guest-list places" : "Join guest list"}
        onPress={() => void submit()}
        loading={submitting}
        disabled={submitting}
        fullWidth
        size="lg"
      />
      <Legal />
    </ScrollView>
  );
}

function EventCard({ resolved }: { resolved: TicketLinkResolve }): React.ReactElement {
  const event = resolved.event!;
  return (
    <View style={styles.eventCard}>
      {event.coverUrl ? <Image source={{ uri: event.coverUrl }} style={styles.cover} /> : null}
      <View style={styles.eventText}>
        <Text style={styles.eyebrow}>{event.brandName.toUpperCase()}</Text>
        <Text style={styles.eventTitle}>{event.title}</Text>
        <Text style={styles.eventMeta}>{dateLabel(event.startAt, event.timezone)}</Text>
        {event.venueLine ? <Text style={styles.eventMeta}>{event.venueLine}</Text> : null}
      </View>
    </View>
  );
}

function Legal(): React.ReactElement {
  return (
    <Text style={styles.legal}>
      By continuing, you agree to Mingla's{" "}
      <Text style={styles.link} onPress={() => void Linking.openURL(PURCHASE_TERMS_URL)}>Terms</Text>
      {" and "}
      <Text style={styles.link} onPress={() => void Linking.openURL(PURCHASE_PRIVACY_URL)}>Privacy Policy</Text>.
    </Text>
  );
}

const styles = StyleSheet.create({
  host: { flex: 1, backgroundColor: "#0c0e12" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: "#0c0e12" },
  content: { width: "100%", maxWidth: 640, alignSelf: "center", padding: spacing.lg, paddingBottom: 64, gap: spacing.md },
  eventCard: { overflow: "hidden", borderRadius: radius.lg, backgroundColor: glass.tint.profileBase, borderWidth: 1, borderColor: glass.border.profileBase },
  cover: { width: "100%", height: 210 },
  eventText: { padding: spacing.lg, gap: 4 },
  eyebrow: { color: accent.warm, fontSize: 11, fontWeight: "800", letterSpacing: 1.4 },
  eventTitle: { color: textTokens.primary, fontSize: 28, fontWeight: "800", letterSpacing: -0.6 },
  eventMeta: { color: textTokens.secondary, fontSize: 14 },
  heading: { color: textTokens.primary, fontSize: 24, fontWeight: "800" },
  body: { color: textTokens.secondary, fontSize: 15, lineHeight: 22 },
  personCard: { padding: spacing.md, gap: spacing.sm, borderRadius: radius.md, backgroundColor: glass.tint.profileBase, borderWidth: 1, borderColor: glass.border.profileBase },
  personHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  personLabel: { color: textTokens.primary, fontSize: 14, fontWeight: "700" },
  dates: { gap: spacing.xs },
  dateRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", padding: spacing.md, borderRadius: radius.md, borderWidth: 1, borderColor: glass.border.profileBase },
  dateRowActive: { borderColor: accent.warm, backgroundColor: "rgba(255,122,69,0.08)" },
  dateText: { color: textTokens.primary, fontSize: 14 },
  ticketCard: { padding: spacing.lg, gap: spacing.xs, borderRadius: radius.lg, backgroundColor: glass.tint.profileBase, borderWidth: 1, borderColor: glass.border.profileBase },
  ticketName: { color: textTokens.primary, fontSize: 22, fontWeight: "800" },
  price: { color: textTokens.primary, fontSize: 28, fontWeight: "800", marginTop: spacing.sm },
  error: { color: semantic.error, fontSize: 13, lineHeight: 18 },
  legal: { color: textTokens.tertiary, textAlign: "center", fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
  link: { color: textTokens.secondary, textDecorationLine: "underline" },
  stateIcon: { width: 58, height: 58, borderRadius: 29, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,122,69,0.12)", marginBottom: spacing.md },
  stateTitle: { color: textTokens.primary, fontSize: 25, fontWeight: "800", textAlign: "center" },
  stateBody: { color: textTokens.secondary, fontSize: 15, lineHeight: 22, textAlign: "center", marginTop: spacing.sm, maxWidth: 420 },
});
