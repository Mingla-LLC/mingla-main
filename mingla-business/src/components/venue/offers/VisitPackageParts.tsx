/**
 * #4490 P3-3 — the group booking parts of `/visit/<groupId>`: the balance
 * card (what is still owed, by when, Pay the rest), what the booking includes
 * (choices, extras), and changing it: guest numbers, another day, extras. A
 * change always shows its price first (the server's preview), then applies;
 * anything still owed is paid from the balance card.
 *
 * Anonymous: the booking token from this device rides with every call.
 */
import React, { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import type { ResolvedTheme, ThemePalette } from "@mingla/offering-rendering";
import {
  OfferingChipRow,
  OfferingChoiceChip,
  OfferingDateStrip,
  OfferingStepper,
  type OfferingDateTile,
} from "@mingla/offering-rendering/OfferingDecideParts";
import { themeBoldFace } from "@mingla/offering-rendering/themeAccentStyle";
import { formatVenueMoney } from "@mingla/brand-rendering/venueMoney";
import {
  addDays,
  entryDateLabel,
  venueClock,
  venueOfferErrorCopy,
  venueToday,
  type EntryBooking,
} from "@mingla/brand-rendering/venueOffers/entryModel";
import {
  balanceCardWords,
  groupRange,
  guestChangeWords,
  packageDayTiles,
  startChipsFor,
  untilWords,
  type GuestChangeSummary,
  type PackageBookingView,
} from "@mingla/brand-rendering/venueOffers/packageModel";

import { hireChangeRange, hireDayTiles, sessionChipsFor } from "@mingla/brand-rendering/venueOffers/hireModel";

import { radius, size, space, type } from "../../../constants/designSystem";
import { VenueOfferGuestError, venueOfferGuestService } from "../../../services/venueOfferGuestService";
import { randomId } from "../../../utils/randomId";
import { Icon, type IconName } from "../../ui/Icon";
import { EntryButton, EntryNote, entryStyles } from "./EntryUi";
import { ExtrasList } from "./ExtrasList";
import { venueOfferQueryKeys } from "./useEntrySelection";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Common {
  booking: EntryBooking;
  pkg: PackageBookingView;
  palette: ThemePalette;
  theme: ResolvedTheme;
  exponent: number;
}

export function VisitBalanceCard({
  booking,
  pkg,
  palette,
  theme,
  exponent,
  now,
  paying,
  onPay,
  note,
}: Common & { now: number; paying: boolean; onPay: () => void; note: string | null }): React.ReactElement | null {
  const words = balanceCardWords(pkg, { currencyCode: booking.currencyCode, exponent, timeZone: booking.venue.timezone, now });
  if (words === null) return null;
  const amount = formatVenueMoney(pkg.balanceDueMinor, booking.currencyCode, exponent);
  return (
    <View
      style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]}
      testID="issue-4490-visit-balance"
    >
      <Text style={[styles.cardTitle, themeBoldFace(theme), { color: palette.primaryText }]} accessibilityRole="header">
        {words.title}
      </Text>
      <Text style={[styles.small, { color: palette.secondaryText }]}>{words.body}</Text>
      {note !== null ? (
        <EntryNote palette={palette} icon="flag" tone="warning" testID="issue-4490-visit-balance-note">
          {note}
        </EntryNote>
      ) : null}
      <EntryButton
        palette={palette}
        theme={theme}
        label={paying ? "Opening payment…" : `Pay the rest · ${amount}`}
        onPress={onPay}
        busy={paying}
        testID="issue-4490-visit-pay-balance"
      />
      <Text style={[styles.caption, { color: palette.tertiaryText }]}>Card, bank transfer or USSD on the secure payment page.</Text>
    </View>
  );
}

/** Choices, extras and what is still owed, for the summary card. */
export function VisitPackageFacts({ booking, pkg, palette, exponent }: Omit<Common, "theme">): React.ReactElement | null {
  const money = (m: number): string => formatVenueMoney(m, booking.currencyCode, exponent);
  if (pkg.offerKind !== "group_package") return null;
  return (
    <View style={styles.facts} testID="issue-4490-visit-package-facts">
      {pkg.inclusions.length > 0 ? (
        <Text style={[styles.small, { color: palette.secondaryText }]}>{`Included: ${pkg.inclusions.map((i) => i.label).join(" · ")}`}</Text>
      ) : null}
      {pkg.answers.map((a) => (
        <Text key={a.question} style={[styles.small, { color: palette.secondaryText }]}>{`${a.question}: ${a.answer}`}</Text>
      ))}
      {pkg.extras.length > 0 ? (
        <Text style={[styles.small, { color: palette.secondaryText }]}>
          {`Extras: ${pkg.extras.map((e) => `${e.qty > 1 ? `${e.qty} × ` : ""}${e.name} ${money(e.amountMinor)}`).join(" · ")}`}
        </Text>
      ) : null}
      <View style={styles.moneyRow}>
        <Text style={[styles.small, styles.grow, { color: palette.primaryText }]}>{`${pkg.guests} × ${booking.offer.name}`}</Text>
        <Text style={[styles.small, { color: palette.primaryText }]}>{money(pkg.packageMinor)}</Text>
      </View>
      <View style={styles.moneyRow}>
        <Text style={[styles.small, styles.grow, { color: palette.primaryText }]}>{booking.vatMode === "none" ? "Total" : "Total with VAT"}</Text>
        <Text style={[styles.small, { color: palette.primaryText }]}>{money(pkg.totalDueMinor)}</Text>
      </View>
      <View style={styles.moneyRow}>
        <Text style={[styles.small, styles.grow, { color: palette.secondaryText }]}>Paid</Text>
        <Text style={[styles.small, { color: palette.secondaryText }]}>{money(pkg.paidOnlineMinor + pkg.paidAtVenueMinor)}</Text>
      </View>
      <View style={styles.moneyRow}>
        <Text style={[styles.row, styles.grow, { color: palette.primaryText }]}>Still to pay</Text>
        <Text style={[styles.row, { color: palette.primaryText }]} testID="issue-4490-visit-still-to-pay">{money(pkg.balanceDueMinor)}</Text>
      </View>
    </View>
  );
}

type Panel = "guests" | "move" | "extras" | null;

export function VisitChanges({
  booking,
  pkg,
  palette,
  theme,
  exponent,
  token,
  onChanged,
  hour = null,
}: Common & {
  token: string | null;
  onChanged: (message: string) => void;
  /** #4490 P5 follow-up — a by-the-hour booking moves to another start, keeping its length. */
  hour?: { startsAt: string; minutes: number } | null;
}): React.ReactElement | null {
  const [panel, setPanel] = useState<Panel>(null);
  const rules = pkg.changeRules;
  const isHour = hour !== null;
  const isPackage = pkg.offerKind === "group_package";
  // #4490 P4 follow-up: a private hire changes guests within its place, and moves to another session.
  const isHire = pkg.offerKind === "private_hire";
  const hireQuery = useQuery({
    queryKey: [...venueOfferQueryKeys.offer(booking.venue.brandSlug ?? "", booking.venue.slug ?? "", booking.offer.id ?? ""), "hire"],
    enabled: isHire && booking.venue.brandSlug !== null && booking.venue.slug !== null && booking.offer.id !== null,
    staleTime: 60_000,
    retry: 1,
    queryFn: () =>
      venueOfferGuestService.hireOffer({
        brandSlug: booking.venue.brandSlug as string,
        venueSlug: booking.venue.slug as string,
        offeringId: booking.offer.id as string,
      }),
  });
  const offerQuery = useQuery({
    queryKey: [...venueOfferQueryKeys.offer(booking.venue.brandSlug ?? "", booking.venue.slug ?? "", booking.offer.id ?? ""), "package"],
    enabled: isPackage && booking.venue.brandSlug !== null && booking.venue.slug !== null && booking.offer.id !== null,
    staleTime: 60_000,
    retry: 1,
    queryFn: () =>
      venueOfferGuestService.packageOffer({
        brandSlug: booking.venue.brandSlug as string,
        venueSlug: booking.venue.slug as string,
        offeringId: booking.offer.id as string,
      }),
  });
  if (rules === null || booking.state !== "confirmed") return null;
  const tz = booking.venue.timezone;
  const guestsUntil = untilWords(rules.guestChangeUntil, tz);
  const moveUntil = untilWords(rules.moveUntil, tz);
  const movesLeft = rules.maxChanges === null ? null : Math.max(0, rules.maxChanges - rules.changesUsed);
  const offer = offerQuery.data ?? null;
  const hasExtras = (offer?.extras.length ?? 0) > 0;

  const rows: Array<{ key: Panel; icon: IconName; label: string; detail: string; on: boolean; testID: string }> = isHour
    ? [
        {
          key: "move",
          icon: "clock",
          label: "Move to another time",
          detail: rules.canMove
            ? `${moveUntil !== null ? `Until ${moveUntil}` : "If it's free"}${movesLeft !== null ? ` · ${movesLeft} ${movesLeft === 1 ? "move" : "moves"} left` : ""}`
            : movesLeft === 0
              ? "You've used your moves"
              : moveUntil !== null ? `Could be moved until ${moveUntil}` : "This booking can't be moved online. Cancel it, or contact the venue.",
          on: rules.canMove,
          testID: "issue-4490-visit-move",
        },
      ]
    : [
    {
      key: "guests",
      icon: "users",
      label: isPackage || isHire ? "Change the number of guests" : "Add more guests",
      detail:
        booking.lines.length > 1
          ? "This booking has several prices. Contact the venue to change it."
          : rules.canChangeGuests
            ? guestsUntil !== null ? `Until ${guestsUntil}` : "Pay the difference, or get some back"
            : guestsUntil !== null ? `Could be changed until ${guestsUntil}` : "Not available for this booking",
      on: rules.canChangeGuests && booking.lines.length <= 1,
      testID: "issue-4490-visit-change-guests",
    },
    {
      key: "move",
      icon: "calendar",
      label: "Move to another day",
      detail: rules.canMove
        ? `${moveUntil !== null ? `Until ${moveUntil}` : "If there's room"}${movesLeft !== null ? ` · ${movesLeft} ${movesLeft === 1 ? "move" : "moves"} left` : ""}`
        : movesLeft === 0
          ? "You've used your moves"
          : moveUntil !== null ? `Could be moved until ${moveUntil}` : "Not available for this booking",
      on: rules.canMove,
      testID: "issue-4490-visit-move",
    },
  ];
  if (isPackage && hasExtras && !isHour) {
    rows.push({
      key: "extras",
      icon: "plus",
      label: "Add extras",
      detail: rules.canAddExtras ? (guestsUntil !== null ? `Until ${guestsUntil}` : "Pay the difference") : "Not available any more",
      on: rules.canAddExtras,
      testID: "issue-4490-visit-add-extras",
    });
  }

  return (
    <View style={[entryStyles.card, { backgroundColor: palette.card, borderColor: palette.panelBorder }]} testID="issue-4490-visit-changes">
      <Text style={[styles.label, { color: palette.tertiaryText }]}>CHANGE YOUR BOOKING</Text>
      {rows.map((r) => (
        <Pressable
          key={r.testID}
          onPress={() => (r.on ? setPanel(panel === r.key ? null : r.key) : undefined)}
          disabled={!r.on}
          accessibilityRole="button"
          accessibilityState={{ disabled: !r.on, expanded: panel === r.key }}
          accessibilityLabel={`${r.label}, ${r.detail}`}
          style={({ pressed }) => [styles.actionRow, !r.on ? styles.off : null, pressed ? styles.pressed : null]}
          testID={r.testID}
        >
          <Icon name={r.icon} size={20} color={palette.primaryText} />
          <View style={styles.grow}>
            <Text style={[styles.row, { color: palette.primaryText }]}>{r.label}</Text>
            <Text style={[styles.caption, { color: palette.secondaryText }]}>{r.detail}</Text>
          </View>
          {r.on ? <Icon name={panel === r.key ? "chevU" : "chevD"} size={18} color={palette.secondaryText} /> : null}
        </Pressable>
      ))}
      {panel === "guests" ? (
        <GuestsChange
          booking={booking}
          pkg={pkg}
          palette={palette}
          theme={theme}
          exponent={exponent}
          token={token}
          range={
            isHire
              ? hireChangeRange(hireQuery.data ?? null, booking.lines[0]?.priceOptionId ?? null) ?? { min: 1, max: Math.max(1, booking.lines.reduce((n, l) => n + l.guests, 0)) }
              : offer !== null
                ? groupRange(offer.options)
                : { min: 1, max: Math.max(1, booking.lines.reduce((n, l) => n + l.guests, 0) * 2) }
          }
          onDone={(m) => {
            setPanel(null);
            onChanged(m);
          }}
        />
      ) : null}
      {panel === "move" && booking.offer.id !== null && hour !== null ? (
        <HourMoveChange
          booking={booking}
          pkg={pkg}
          palette={palette}
          theme={theme}
          exponent={exponent}
          token={token}
          hour={hour}
          onDone={(m) => {
            setPanel(null);
            onChanged(m);
          }}
        />
      ) : panel === "move" && booking.offer.id !== null && isHire ? (
        <HireMoveChange
          booking={booking}
          pkg={pkg}
          palette={palette}
          theme={theme}
          exponent={exponent}
          token={token}
          sessions={hireQuery.data?.sessions ?? []}
          onDone={(m) => {
            setPanel(null);
            onChanged(m);
          }}
        />
      ) : panel === "move" && booking.offer.id !== null ? (
        <MoveChange
          booking={booking}
          pkg={pkg}
          palette={palette}
          theme={theme}
          exponent={exponent}
          token={token}
          onDone={(m) => {
            setPanel(null);
            onChanged(m);
          }}
        />
      ) : null}
      {panel === "extras" && offer !== null ? (
        <ExtrasChange
          booking={booking}
          pkg={pkg}
          palette={palette}
          theme={theme}
          exponent={exponent}
          token={token}
          extras={offer.extras}
          onDone={(m) => {
            setPanel(null);
            onChanged(m);
          }}
        />
      ) : null}
    </View>
  );
}

/** Preview a change (debounced), then apply it with the booking's version. */
function useGuestChange(
  booking: EntryBooking,
  token: string | null,
  change: "change_guests" | "move_date" | "add_extras",
  payload: Record<string, unknown> | null,
): { summary: GuestChangeSummary | null; error: string | null; loading: boolean; applying: boolean; apply: (done: (s: GuestChangeSummary) => void) => void } {
  const [summary, setSummary] = useState<GuestChangeSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const key = payload === null ? null : JSON.stringify(payload);
  useEffect(() => {
    setSummary(null);
    setError(null);
    if (payload === null) return undefined;
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      venueOfferGuestService
        .changePreview({ groupId: booking.groupId, token, change, payload })
        .then((s) => {
          if (live) setSummary(s);
        })
        .catch((e: unknown) => {
          if (live) setError(venueOfferErrorCopy(e instanceof VenueOfferGuestError ? e.code : null, e instanceof VenueOfferGuestError ? e.remaining : null));
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return {
    summary,
    error,
    loading,
    applying,
    apply: (done) => {
      if (payload === null || applying) return;
      setApplying(true);
      setError(null);
      venueOfferGuestService
        .change({
          groupId: booking.groupId,
          token,
          change,
          payload,
          expectedVersion: summary?.groupVersion ?? booking.version,
          idempotencyKey: `venue-offer:change:${randomId()}`,
        })
        .then(done)
        .catch((e: unknown) => setError(venueOfferErrorCopy(e instanceof VenueOfferGuestError ? e.code : null, e instanceof VenueOfferGuestError ? e.remaining : null)))
        .finally(() => setApplying(false));
    },
  };
}

function PreviewNote({ palette, summary, loading, error, exponent, testID }: { palette: ThemePalette; summary: GuestChangeSummary | null; loading: boolean; error: string | null; exponent: number; testID: string }): React.ReactElement | null {
  if (error !== null) {
    return (
      <EntryNote palette={palette} icon="flag" tone="error" testID={`${testID}-error`}>
        {error}
      </EntryNote>
    );
  }
  if (summary === null) return loading ? <Text style={[styles.small, { color: palette.secondaryText }]}>Working out the price…</Text> : null;
  const words = guestChangeWords(summary, exponent);
  return (
    <EntryNote palette={palette} icon={summary.refundMinor > 0 ? "refund" : "cash"} tone={summary.amountMinor > 0 ? "warning" : "neutral"} testID={`${testID}-preview`}>
      <View style={styles.noteBody}>
        <Text style={[styles.row, { color: palette.primaryText }]}>{words.title}</Text>
        <Text style={[styles.small, { color: palette.primaryText }]}>{words.body}</Text>
      </View>
    </EntryNote>
  );
}

function GuestsChange({
  booking,
  palette,
  theme,
  exponent,
  token,
  range,
  onDone,
}: Common & { token: string | null; range: { min: number; max: number }; onDone: (m: string) => void }): React.ReactElement {
  const now = booking.lines.reduce((n, l) => n + l.guests, 0);
  const [guests, setGuests] = useState(now);
  const payload = guests === now ? null : { guests };
  const c = useGuestChange(booking, token, "change_guests", payload);
  return (
    <View style={styles.panel} testID="issue-4490-visit-guests-panel">
      <View style={styles.stepRow}>
        <View style={styles.grow}>
          <Text style={[styles.row, themeBoldFace(theme), { color: palette.primaryText }]}>{`${guests} guests`}</Text>
          <Text style={[styles.caption, { color: palette.secondaryText }]}>{`Booked for ${now}. ${range.min} to ${range.max} guests.`}</Text>
        </View>
        <OfferingStepper
          palette={palette}
          value={guests}
          min={Math.min(range.min, now)}
          max={Math.max(range.max, now)}
          onChange={setGuests}
          decrementLabel="One guest fewer"
          incrementLabel="One guest more"
          valueLabel={`${guests} guests`}
          testID="issue-4490-visit-guests-stepper"
        />
      </View>
      <PreviewNote palette={palette} summary={c.summary} loading={c.loading} error={c.error} exponent={exponent} testID="issue-4490-visit-guests" />
      <EntryButton
        palette={palette}
        theme={theme}
        label={payload === null ? "Change the number first" : `Change to ${guests} guests`}
        onPress={() => c.apply((s) => onDone(s.amountMinor > 0 ? `Changed to ${guests} guests. Pay the difference below.` : `Changed to ${guests} guests.`))}
        disabled={payload === null || c.summary === null}
        busy={c.applying}
        testID="issue-4490-visit-guests-confirm"
      />
    </View>
  );
}

function MoveChange({ booking, pkg, palette, theme, exponent, token, onDone }: Common & { token: string | null; onDone: (m: string) => void }): React.ReactElement {
  const tz = booking.venue.timezone;
  const from = useMemo(() => venueToday(new Date(), tz), [tz]);
  const guests = booking.lines.reduce((n, l) => n + l.guests, 0);
  const daysQuery = useQuery({
    queryKey: venueOfferQueryKeys.days(booking.offer.id ?? "", from, null),
    staleTime: 30_000,
    retry: 1,
    queryFn: () => venueOfferGuestService.availability({ offeringId: booking.offer.id as string, from, to: addDays(from, 59) }),
  });
  const rows = useMemo(() => daysQuery.data ?? [], [daysQuery.data]);
  const tiles = useMemo(() => packageDayTiles(rows, from, 60), [rows, from]);
  const [date, setDate] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<string | null>(null);
  const chips = startChipsFor(rows, date, guests, tz);
  const payload = windowId === null || windowId === pkg.windowId ? null : { windowId };
  const c = useGuestChange(booking, token, "move_date", payload);
  const stripTiles: OfferingDateTile[] = tiles.map((t, index) => ({
    key: t.date,
    top: index === 0 ? "Today" : t.top,
    big: t.big,
    bottom: t.date === booking.window?.localDate ? "Booked" : t.bottom.length > 0 ? t.bottom : MONTHS[Number(t.date.slice(5, 7)) - 1] ?? "",
    selected: t.date === date,
    accessibilityLabel: entryDateLabel(t.date),
  }));
  return (
    <View style={styles.panel} testID="issue-4490-visit-move-panel">
      {daysQuery.isError ? (
        <EntryNote palette={palette} icon="flag" tone="error">We couldn&apos;t load the days. Close this and try again.</EntryNote>
      ) : daysQuery.isLoading ? (
        <View style={[styles.stripSkeleton, { backgroundColor: palette.panel }]} accessibilityLabel="Loading days" />
      ) : (
        <OfferingDateStrip
          palette={palette}
          tiles={stripTiles}
          onPress={(d) => {
            setDate(d);
            setWindowId(null);
          }}
          fontFamily={themeBoldFace(theme).fontFamily}
          accessibilityLabel="Choose the new day"
          testID="issue-4490-visit-move-day"
        />
      )}
      {date !== null ? (
        chips.length === 0 ? (
          <Text style={[styles.small, { color: palette.secondaryText }]}>{`Nothing runs on ${entryDateLabel(date)}. Pick another day.`}</Text>
        ) : (
          <OfferingChipRow accessibilityLabel="Choose the new start time">
            {chips.map((chip) => (
              <OfferingChoiceChip
                key={chip.windowId}
                palette={palette}
                label={chip.time}
                note={chip.note}
                selected={chip.windowId === windowId}
                disabled={!chip.usable}
                onPress={() => setWindowId(chip.windowId)}
                role="radio"
                testID={`issue-4490-visit-move-time-${chip.time}`}
              />
            ))}
          </OfferingChipRow>
        )
      ) : (
        <Text style={[styles.small, { color: palette.secondaryText }]}>Pick the new day, then the time.</Text>
      )}
      <PreviewNote palette={palette} summary={c.summary} loading={c.loading} error={c.error} exponent={exponent} testID="issue-4490-visit-move" />
      <EntryButton
        palette={palette}
        theme={theme}
        label={date !== null && payload !== null ? `Move to ${entryDateLabel(date)}` : "Pick a new day and time"}
        onPress={() => c.apply(() => onDone(date !== null ? `Moved to ${entryDateLabel(date)}.` : "Moved."))}
        disabled={payload === null || c.summary === null}
        busy={c.applying}
        testID="issue-4490-visit-move-confirm"
      />
    </View>
  );
}

/**
 * #4490 P5 follow-up — move a by-the-hour booking to another start (same
 * length): a day, then the starts that have that long free. The server makes
 * the new time's window and prices the move first.
 */
function HourMoveChange({
  booking,
  palette,
  theme,
  exponent,
  token,
  hour,
  onDone,
}: Common & { token: string | null; hour: { startsAt: string; minutes: number }; onDone: (m: string) => void }): React.ReactElement {
  const tz = booking.venue.timezone;
  const from = useMemo(() => venueToday(new Date(), tz), [tz]);
  const guests = booking.lines.reduce((n, l) => n + l.guests, 0);
  const [date, setDate] = useState<string>(booking.window?.localDate ?? from);
  const [startsAt, setStartsAt] = useState<string | null>(null);
  const dayQuery = useQuery({
    queryKey: ["venueOfferGuest", "hourMoveDay", booking.offer.id ?? "", date, guests],
    staleTime: 30_000,
    retry: 1,
    queryFn: () => venueOfferGuestService.hourDay({ offeringId: booking.offer.id as string, date, guests }),
  });
  const starts = (dayQuery.data?.day.starts ?? []).filter((x) => x.startsAt !== hour.startsAt);
  const payload =
    startsAt === null || booking.offer.id === null ? null : { offeringId: booking.offer.id, startsAt, minutes: hour.minutes };
  const c = useGuestChange(booking, token, "move_date", payload);
  const tiles: OfferingDateTile[] = Array.from({ length: 21 }, (_, i) => {
    const d = addDays(from, i);
    return {
      key: d,
      top: i === 0 ? "Today" : new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`)),
      big: String(Number(d.slice(8, 10))),
      bottom: d === booking.window?.localDate ? "Booked" : MONTHS[Number(d.slice(5, 7)) - 1] ?? "",
      selected: d === date,
      accessibilityLabel: entryDateLabel(d),
    };
  });
  const lengthWords = hour.minutes % 60 === 0 ? `${hour.minutes / 60} ${hour.minutes === 60 ? "hour" : "hours"}` : `${hour.minutes} minutes`;
  const dayStatus = dayQuery.data?.day.status ?? null;
  return (
    <View style={styles.panel} testID="issue-4490-visit-hour-move-panel">
      <Text style={[styles.small, { color: palette.secondaryText }]}>{`Same length (${lengthWords}). Pick a day, then a free start.`}</Text>
      <OfferingDateStrip
        palette={palette}
        tiles={tiles}
        onPress={(d) => {
          setDate(d);
          setStartsAt(null);
        }}
        fontFamily={themeBoldFace(theme).fontFamily}
        accessibilityLabel="Choose the new day"
        testID="issue-4490-visit-hour-move-day"
      />
      {dayQuery.isLoading ? (
        <View style={[styles.stripSkeleton, { backgroundColor: palette.panel }]} accessibilityLabel="Loading times" />
      ) : dayQuery.isError ? (
        <EntryNote palette={palette} icon="flag" tone="error">We couldn&apos;t load the times. Pick the day again.</EntryNote>
      ) : dayStatus !== "open" ? (
        <Text style={[styles.small, { color: palette.secondaryText }]}>
          {dayStatus === "closed" ? `Closed on ${entryDateLabel(date)}. Pick another day.` : `Not bookable on ${entryDateLabel(date)}. Pick another day.`}
        </Text>
      ) : starts.length === 0 ? (
        <Text style={[styles.small, { color: palette.secondaryText }]}>{`Nothing free on ${entryDateLabel(date)}. Pick another day.`}</Text>
      ) : (
        <OfferingChipRow accessibilityLabel="Choose the new start time">
          {starts.map((x) => {
            const fits = x.maxMinutes >= hour.minutes && x.places > 0;
            const label = venueClock(x.startsAt, tz) ?? x.startsAt.slice(11, 16);
            return (
              <OfferingChoiceChip
                key={x.startsAt}
                palette={palette}
                label={label}
                note={fits ? null : "Too short"}
                selected={x.startsAt === startsAt}
                disabled={!fits}
                onPress={() => setStartsAt(x.startsAt)}
                role="radio"
                testID={`issue-4490-visit-hour-move-time-${label}`}
              />
            );
          })}
        </OfferingChipRow>
      )}
      <PreviewNote palette={palette} summary={c.summary} loading={c.loading} error={c.error} exponent={exponent} testID="issue-4490-visit-hour-move" />
      <EntryButton
        palette={palette}
        theme={theme}
        label={startsAt !== null ? `Move to ${entryDateLabel(date)}, ${venueClock(startsAt, tz) ?? ""}` : "Pick a new time"}
        onPress={() => c.apply(() => onDone(startsAt !== null ? `Moved to ${entryDateLabel(date)}, ${venueClock(startsAt, tz) ?? ""}.` : "Moved."))}
        disabled={payload === null || c.summary === null}
        busy={c.applying}
        testID="issue-4490-visit-hour-move-confirm"
      />
    </View>
  );
}

/** #4490 P4 follow-up — move a private hire to another day's session; the same place must be free (setup and cleanup included). */
function HireMoveChange({
  booking,
  pkg,
  palette,
  theme,
  exponent,
  token,
  sessions,
  onDone,
}: Common & { token: string | null; sessions: Parameters<typeof sessionChipsFor>[2]; onDone: (m: string) => void }): React.ReactElement {
  const tz = booking.venue.timezone;
  const from = useMemo(() => venueToday(new Date(), tz), [tz]);
  const guests = booking.lines.reduce((n, l) => n + l.guests, 0);
  const daysQuery = useQuery({
    queryKey: ["venueOfferGuest", "hireDays", booking.offer.id ?? "", from, guests],
    staleTime: 30_000,
    retry: 1,
    queryFn: () => venueOfferGuestService.hireDays({ offeringId: booking.offer.id as string, from, to: addDays(from, 59), guests }),
  });
  const rows = useMemo(() => daysQuery.data ?? [], [daysQuery.data]);
  const tiles = useMemo(() => hireDayTiles(rows, from, 60), [rows, from]);
  const [date, setDate] = useState<string | null>(null);
  const [windowId, setWindowId] = useState<string | null>(null);
  const chips = sessionChipsFor(rows, date, sessions, tz, true);
  const payload = windowId === null || windowId === pkg.windowId ? null : { windowId };
  const c = useGuestChange(booking, token, "move_date", payload);
  const stripTiles: OfferingDateTile[] = tiles.map((t, index) => ({
    key: t.date,
    top: index === 0 ? "Today" : new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${t.date}T12:00:00Z`)),
    big: String(Number(t.date.slice(8, 10))),
    bottom: t.date === booking.window?.localDate ? "Booked" : t.word.length > 0 ? t.word : MONTHS[Number(t.date.slice(5, 7)) - 1] ?? "",
    selected: t.date === date,
    disabled: t.state === "none",
    accessibilityLabel: `${entryDateLabel(t.date)}${t.word.length > 0 ? `, ${t.word}` : ""}`,
  }));
  return (
    <View style={styles.panel} testID="issue-4490-visit-move-panel">
      <Text style={[styles.small, { color: palette.secondaryText }]}>Your space has to be free on the new day.</Text>
      {daysQuery.isError ? (
        <EntryNote palette={palette} icon="flag" tone="error">We couldn&apos;t load the days. Close this and try again.</EntryNote>
      ) : daysQuery.isLoading ? (
        <View style={[styles.stripSkeleton, { backgroundColor: palette.panel }]} accessibilityLabel="Loading days" />
      ) : (
        <OfferingDateStrip
          palette={palette}
          tiles={stripTiles}
          onPress={(d) => {
            setDate(d);
            setWindowId(null);
          }}
          fontFamily={themeBoldFace(theme).fontFamily}
          accessibilityLabel="Choose the new day"
          testID="issue-4490-visit-move-day"
        />
      )}
      {date !== null ? (
        chips.length === 0 ? (
          <Text style={[styles.small, { color: palette.secondaryText }]}>{`Nothing to hire on ${entryDateLabel(date)}. Pick another day.`}</Text>
        ) : (
          <OfferingChipRow accessibilityLabel="Choose the new session">
            {chips.map((chip) => (
              <OfferingChoiceChip
                key={chip.windowId}
                palette={palette}
                label={`${chip.label}${chip.times !== null ? ` ${chip.times}` : ""}`}
                note={chip.windowId === pkg.windowId ? "Booked" : chip.note}
                selected={chip.windowId === windowId}
                disabled={chip.note !== null || chip.windowId === pkg.windowId}
                onPress={() => setWindowId(chip.windowId)}
                role="radio"
                testID={`issue-4490-visit-move-session-${chip.label.replace(/\s+/g, "-").toLowerCase()}`}
              />
            ))}
          </OfferingChipRow>
        )
      ) : (
        <Text style={[styles.small, { color: palette.secondaryText }]}>Pick the new day, then the session.</Text>
      )}
      <PreviewNote palette={palette} summary={c.summary} loading={c.loading} error={c.error} exponent={exponent} testID="issue-4490-visit-move" />
      <EntryButton
        palette={palette}
        theme={theme}
        label={date !== null && payload !== null ? `Move to ${entryDateLabel(date)}` : "Pick a new day and session"}
        onPress={() => c.apply(() => onDone(date !== null ? `Moved to ${entryDateLabel(date)}.` : "Moved."))}
        disabled={payload === null || c.summary === null}
        busy={c.applying}
        testID="issue-4490-visit-move-confirm"
      />
    </View>
  );
}

function ExtrasChange({
  booking,
  pkg,
  palette,
  theme,
  exponent,
  token,
  extras,
  onDone,
}: Common & { token: string | null; extras: Array<{ id: string; name: string; priceMinor: number; per: "booking" | "guest" }>; onDone: (m: string) => void }): React.ReactElement {
  const [picked, setPicked] = useState<string[]>([]);
  const payload = picked.length === 0 ? null : { extras: picked.map((id) => ({ id })) };
  const c = useGuestChange(booking, token, "add_extras", payload);
  return (
    <View style={styles.panel} testID="issue-4490-visit-extras-panel">
      <ExtrasList
        palette={palette}
        theme={theme}
        extras={extras}
        picked={picked}
        onToggle={(id) => setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
        currencyCode={booking.currencyCode}
        exponent={exponent}
        added={pkg.extras.map((e) => e.id)}
        testID="issue-4490-visit-extras"
      />
      <PreviewNote palette={palette} summary={c.summary} loading={c.loading} error={c.error} exponent={exponent} testID="issue-4490-visit-extras" />
      <EntryButton
        palette={palette}
        theme={theme}
        label={payload === null ? "Tick an extra first" : "Add to my booking"}
        onPress={() => c.apply(() => onDone("Added to your booking. Pay the difference below."))}
        disabled={payload === null || c.summary === null}
        busy={c.applying}
        testID="issue-4490-visit-extras-confirm"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cardTitle: { ...type.h2 },
  label: { ...type.label },
  small: { ...type.small },
  caption: { ...type.caption },
  row: { ...type.row },
  grow: { flex: 1, minWidth: 0 },
  facts: { gap: space[1] },
  moneyRow: { flexDirection: "row", alignItems: "baseline", gap: space[2] },
  actionRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: size.btn.lg, borderRadius: radius.sm },
  off: { opacity: 0.55 },
  pressed: { opacity: 0.8 },
  panel: { gap: space[3], paddingTop: space[2] },
  stepRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  noteBody: { gap: 2 },
  stripSkeleton: { height: size.btn.xl + space[4], borderRadius: radius.md },
});
