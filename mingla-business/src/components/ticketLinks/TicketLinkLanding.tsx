import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { ThemePalette } from "@mingla/offering-rendering";

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
import type { PublicEventOccurrence } from "../../services/publicEventOccurrencesService";
import {
  ticketLinkAsksForDates,
  ticketLinkCheckoutDates,
  ticketLinkCover,
  ticketLinkDatesReady,
  ticketLinkSignupDates,
} from "../../utils/ticketLinkLandingModel";
import { Button } from "../ui/Button";
import { EventCoverMedia } from "../ui/EventCoverMedia";
import { Icon } from "../ui/Icon";
import { Input } from "../ui/Input";
import { PhoneField, usePhoneEntry } from "../ui/PhoneField";
import { BuyerClaimCard } from "../checkout/DownloadMinglaCta";
import { BUYER_CLAIM_COPY } from "../../constants/buyerClaimCopy";

// issue #3827 — the shared multi-select day chooser the public event page
// uses (checkbox rows, Space + aria-checked on web, reduced motion). Lazy for
// the same reason it is lazy there: single-date links never load it.
const MultiDateDayChooser = React.lazy(() => import("../event/MultiDateDayChooser"));

// The link page's own dark surface, expressed as the chooser's palette.
const LINK_PALETTE: ThemePalette = {
  page: "#0c0e12",
  accent: accent.warm,
  accentText: accent.warm,
  primaryText: textTokens.primary,
  secondaryText: textTokens.secondary,
  tertiaryText: textTokens.tertiary,
  panel: glass.tint.profileBase,
  panelStrong: glass.tint.profileBase,
  panelBorder: glass.border.profileBase,
  card: glass.tint.profileBase,
  cutoutBorder: glass.border.profileBase,
  glass: glass.tint.profileBase,
  glassTint: "dark",
  accentWash: "rgba(235,120,37,0.10)",
};

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

type TicketLinkSignupResult = {
  status: "issued" | "pending";
  alreadyPending?: boolean;
  people: Array<{ name: string; maskedEmail: string }>;
};

const signupTicketLink = (input: {
  token: string;
  lead: { name: string; email: string; phone: string };
  guests: Array<{ name: string; email: string; phone: string }>;
  eventDateId: string | null;
  eventDateIds?: string[];
  clientRequestId: string;
  website: string;
}): Promise<TicketLinkSignupResult> =>
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

const toOccurrences = (dates: NonNullable<TicketLinkResolve["dates"]>): PublicEventOccurrence[] =>
  dates.map((date) => ({
    id: date.id,
    startAt: date.startAt,
    endAt: date.endAt,
    timezone: date.timezone,
    isMaster: false,
    ticketsRemaining: null,
  }));

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
  const [selectedDateIds, setSelectedDateIds] = useState<readonly string[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<TicketLinkSignupResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    resolveTicketLink(token)
      .then((value) => {
        if (cancelled) return;
        setResolved(value);
        setSelectedDateIds([]);
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
  const needsDateChoice = resolved !== null && ticketLinkAsksForDates(resolved);
  const datesReady = resolved === null || ticketLinkDatesReady(resolved, selectedDateIds);
  const occurrences = useMemo(
    () => toOccurrences(resolved?.dates ?? []),
    [resolved?.dates],
  );
  const toggleDate = useCallback((id: string): void => {
    setSelectedDateIds((current) => {
      const toggled = current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
      return occurrences.map((row) => row.id).filter((value) => toggled.includes(value));
    });
  }, [occurrences]);
  const valid = datesReady && people.every(
    (person) =>
      person.name.trim().length > 0 &&
      EMAIL.test(person.email.trim()) &&
      /^\+[1-9][0-9]{1,14}$/.test(person.phone),
  ) && new Set(people.map((person) => person.email.trim().toLowerCase())).size === people.length;

  const submit = useCallback(async (): Promise<void> => {
    setShowErrors(true);
    setError(null);
    if (!valid || submitting || resolved === null) return;
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
        ...ticketLinkSignupDates(resolved, selectedDateIds),
        clientRequestId: randomUuid(),
        website: "",
      });
      setOutcome(answer);
    } catch (cause) {
      setError(
        typeof (cause as { message?: unknown })?.message === "string"
          ? (cause as Error).message
          : publicLinkErrorCopy("internal"),
      );
    } finally {
      setSubmitting(false);
    }
  }, [guests, lead, resolved, selectedDateIds, submitting, token, valid]);

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
    const pending = outcome.status === "pending";
    if (!pending) {
      const first = outcome.people[0] ?? null;
      const digits = lead.phone.replace(/\D/g, "");
      return (
        <View style={styles.center}>
          <BuyerClaimCard
            kind="ticket"
            email={first?.maskedEmail ?? null}
            phoneLast4={digits.length >= 4 ? digits.slice(-4) : null}
            shortUrl={null}
            handoff={null}
            textSent
            analyticsSurface="guest_list_issued"
            fallbackEntity={{
              entityType: "event",
              brandSlug: resolved.event.brandSlug,
              entitySlug: resolved.event.eventSlug,
            }}
            waitingOverride={BUYER_CLAIM_COPY.guestList.title}
          />
        </View>
      );
    }
    return (
      <View style={styles.center}>
        <View style={styles.stateIcon}>
          <Icon name="clock" size={28} color={accent.warm} />
        </View>
        <Text style={styles.stateTitle}>{BUYER_CLAIM_COPY.guestList.pending}</Text>
        <Text style={styles.stateBody}>
          {BUYER_CLAIM_COPY.guestList.pendingBody}
        </Text>
      </View>
    );
  }

  const { event, tier } = resolved;
  const dateChooser = (isPaid: boolean): React.ReactElement | null => needsDateChoice ? (
    <View style={styles.dates}>
      <React.Suspense fallback={<ActivityIndicator color={accent.warm} />}>
        <MultiDateDayChooser
          timezone={event.timezone}
          palette={LINK_PALETTE}
          occurrences={occurrences}
          selectedOccurrenceIds={selectedDateIds}
          pricingMode={resolved.multiDatePricingMode ?? "per_day"}
          allDaysPass={resolved.allDaysPass === true}
          isPaid={isPaid && (tier.allInCents ?? tier.priceCents ?? 0) > 0}
          highlightUnchosen={showErrors && !datesReady}
          onToggle={toggleDate}
        />
      </React.Suspense>
    </View>
  ) : null;
  if (resolved.kind === "private_ticket") {
    const continueToCheckout = (): void => {
      setShowErrors(true);
      if (!resolved.eventId || !datesReady) return;
      const path = checkoutPublicPathWithSeed(resolved.eventId, { [tier.id]: 1 }, ticketLinkCheckoutDates(resolved, selectedDateIds));
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
        {dateChooser(true)}
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
        Add contact details for everyone coming. We&apos;ll email and text each
        person a link to their ticket.
      </Text>
      {dateChooser(false)}
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
      {showErrors && !valid && datesReady ? (
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

export function TicketLinkCoverMedia({
  event,
}: {
  event: NonNullable<TicketLinkResolve["event"]>;
}): React.ReactElement | null {
  // issue #3827 — a video cover plays through the shared EventCoverMedia with
  // its poster; if the video cannot play, its poster is drawn as an image.
  const [videoFailed, setVideoFailed] = useState(false);
  useEffect(() => { setVideoFailed(false); }, [event.coverUrl]);
  const cover = ticketLinkCover(event, videoFailed);
  if (cover === null) return null;
  return (
    <EventCoverMedia
      key={`${cover.mediaType}:${cover.mediaUrl}`}
      mediaUrl={cover.mediaUrl}
      mediaType={cover.mediaType}
      posterUrl={cover.posterUrl}
      radius={0}
      height={210}
      label="Event cover"
      onMediaError={cover.mediaType === "video" ? () => setVideoFailed(true) : undefined}
      testID="ticket-link-cover"
    />
  );
}

function EventCard({ resolved }: { resolved: TicketLinkResolve }): React.ReactElement {
  const event = resolved.event!;
  return (
    <View style={styles.eventCard}>
      <TicketLinkCoverMedia event={event} />
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
      {"By continuing, you agree to Mingla's "}
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
