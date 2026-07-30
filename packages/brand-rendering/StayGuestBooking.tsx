import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import type {
  offeringSurfaceStyles,
  ResolvedTheme,
  ThemePalette,
} from "@mingla/offering-rendering";

import {
  buildStayRoomCartAllocations,
  formatStayMoney,
  isValidStayDateRange,
  stayCheckoutMode,
  validateStayGuestCart,
  type PublicStayDetail,
  type PublicStayOffering,
  type StayGuestCartLineInput,
  type StayGuestCheckoutInput,
  type StayQuote,
} from "./stayGuest";

type Surface = ReturnType<typeof offeringSurfaceStyles>;

export interface StayGuestBookingProps {
  detail: PublicStayDetail | null;
  state: "loading" | "ready" | "unavailable" | "error";
  palette: ThemePalette;
  surface: Surface;
  theme: ResolvedTheme;
  submitting?: boolean;
  errorMessage?: string | null;
  quote?: StayQuote | null;
  onRetry?: () => void;
  onSubmit: (input: StayGuestCheckoutInput) => void | Promise<void>;
  onConfirmQuote?: () => void | Promise<void>;
  onEditQuote?: () => void;
  onAnalytics?: (
    event:
      | "stay_search_changed"
      | "stay_offering_viewed"
      | "stay_cart_changed"
      | "stay_checkout_started",
    properties?: Record<string, string | number | boolean | null>,
  ) => void;
}

const isoDateFromOffset = (offset: number): string => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};

const labelForPricingUnit = (unit: PublicStayOffering["price"]["pricingUnit"]): string =>
  ({
    room_night: "per night",
    place_booking: "per booking",
    place_unit: "per unit",
    place_guest: "per guest",
  })[unit];

export function StayGuestBooking({
  detail,
  state,
  palette,
  surface,
  theme,
  submitting = false,
  errorMessage = null,
  quote = null,
  onRetry,
  onSubmit,
  onConfirmQuote,
  onEditQuote,
  onAnalytics,
}: StayGuestBookingProps): React.ReactElement {
  const [activeKind, setActiveKind] = useState<"room" | "place">("room");
  const [checkIn, setCheckIn] = useState(isoDateFromOffset(1));
  const [checkOut, setCheckOut] = useState(isoDateFromOffset(2));
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState(0);
  const [roomQuantities, setRoomQuantities] = useState<Record<string, number>>({});
  const [placeSelections, setPlaceSelections] = useState<
    Record<string, string[]>
  >({});
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);

  const offerings = detail?.offerings ?? [];
  const rooms = offerings.filter((item) => item.kind === "room");
  const places = offerings.filter((item) => item.kind === "place");
  const roomAllocationPlan = useMemo(
    () =>
      buildStayRoomCartAllocations({
        rooms: rooms
          .filter((room) => (roomQuantities[room.id] ?? 0) > 0)
          .map((room) => ({
            offeringId: room.id,
            quantity: roomQuantities[room.id] ?? 0,
            minGuests: room.minGuests,
            maxGuests: room.maxGuests,
            maxAdults: room.maxAdults ?? room.maxGuests,
            maxChildren: room.maxChildren ?? room.maxGuests,
          })),
        adults,
        children,
      }),
    [adults, children, roomQuantities, rooms],
  );

  const lines = useMemo<StayGuestCartLineInput[]>(() => {
    if (detail === null) return [];
    const next: StayGuestCartLineInput[] = [];
    for (const room of rooms) {
      const quantity = roomQuantities[room.id] ?? 0;
      if (quantity < 1) continue;
      const allocations = roomAllocationPlan?.[room.id] ?? null;
      if (allocations !== null && allocations.length === quantity) {
        next.push({
          kind: "room",
          offeringId: room.id,
          checkIn,
          checkOut,
          quantity,
          allocations,
        });
      }
    }
    for (const place of places) {
      for (const placeWindowId of placeSelections[place.id] ?? []) {
        next.push({
          kind: "place",
          offeringId: place.id,
          placeWindowId,
          ...(place.inventoryBasis === "exclusive_units" ? { units: 1 } : {}),
          guests: adults + children,
          adults,
          children,
        });
      }
    }
    return next;
  }, [
    adults,
    checkIn,
    checkOut,
    children,
    detail,
    placeSelections,
    places,
    roomAllocationPlan,
    roomQuantities,
    rooms,
  ]);

  const selectionCount = lines.reduce(
    (sum, line) => sum + (line.kind === "room" ? line.quantity : 1),
    0,
  );
  const mode = detail === null ? "instant" : stayCheckoutMode(detail, lines);

  if (state === "loading") {
    return (
      <View style={[styles.state, surface.card]}>
        <ActivityIndicator color={palette.accent} />
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          Loading Rooms and Places…
        </Text>
      </View>
    );
  }
  if (state === "error") {
    return (
      <View style={[styles.state, surface.card]}>
        <Text style={[styles.heading, { color: palette.primaryText }]}>
          This Stay could not load
        </Text>
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          Try again in a moment.
        </Text>
        {onRetry ? (
          <ActionButton label="Try again" palette={palette} onPress={onRetry} />
        ) : null}
      </View>
    );
  }
  if (state === "unavailable" || detail === null) {
    return (
      <View style={[styles.state, surface.card]}>
        <Text style={[styles.heading, { color: palette.primaryText }]}>
          Reservations are not open yet
        </Text>
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          This Stay is not taking Room or Place reservations right now.
        </Text>
      </View>
    );
  }

  if (quote !== null) {
    return (
      <View style={[styles.checkout, surface.card]}>
        <Text style={[styles.label, { color: palette.tertiaryText }]}>
          EXACT TOTAL · {quote.currencyCode}
        </Text>
        <Text style={[styles.total, { color: palette.primaryText }]}>
          {formatStayMoney(quote.totalMinor, quote.currencyCode)}
        </Text>
        <MoneyRow
          label="Rooms and Places"
          amount={quote.sourceSubtotalMinor}
          currency={quote.currencyCode}
          palette={palette}
        />
        <MoneyRow
          label="Fees"
          amount={quote.feeTotalMinor}
          currency={quote.currencyCode}
          palette={palette}
        />
        <MoneyRow
          label="Taxes"
          amount={quote.taxTotalMinor}
          currency={quote.currencyCode}
          palette={palette}
        />
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          {quote.mode === "request"
            ? "This is a Request reservation. You will not be charged unless the Stay approves it."
            : `This price is held until ${new Date(quote.expiresAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}.`}
        </Text>
        {errorMessage ? (
          <Text accessibilityRole="alert" style={styles.errorText}>
            {errorMessage}
          </Text>
        ) : null}
        <ActionButton
          label={
            submitting
              ? "Confirming…"
              : quote.mode === "request"
                ? "Send request"
                : "Confirm and pay"
          }
          palette={palette}
          disabled={submitting || onConfirmQuote === undefined}
          onPress={() => {
            void onConfirmQuote?.();
          }}
        />
        {onEditQuote ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit Stay selections"
            disabled={submitting}
            onPress={onEditQuote}
            style={styles.editButton}
          >
            <Text style={[styles.editText, { color: palette.accent }]}>
              Edit selections
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  const visibleOfferings = activeKind === "room" ? rooms : places;
  const dateError =
    !isValidStayDateRange(checkIn, checkOut)
      ? "Check-out must be after check-in."
      : null;
  const hasSelectedRoom = rooms.some(
    (room) => (roomQuantities[room.id] ?? 0) > 0,
  );
  const roomAllocationError = hasSelectedRoom && roomAllocationPlan === null
    ? "Guest counts must fit each selected Room."
    : null;

  const submit = (): void => {
    const cartError =
      dateError ??
      roomAllocationError ??
      validateStayGuestCart({ detail, lines });
    const cleanName = name.trim();
    const cleanEmail = email.trim();
    const cleanPhone = phone.trim();
    if (cartError !== null) {
      setValidationError(cartError);
      return;
    }
    if (cleanName.length < 1 || (cleanEmail.length < 3 && cleanPhone.length < 3)) {
      setValidationError("Add your name and an email address or phone number.");
      return;
    }
    setValidationError(null);
    onAnalytics?.("stay_checkout_started", {
      venue_id: detail.venueId,
      line_count: lines.length,
      selection_count: selectionCount,
      mode,
    });
    void onSubmit({
      lines,
      guest: {
        name: cleanName,
        ...(cleanEmail ? { email: cleanEmail } : {}),
        ...(cleanPhone ? { phone: cleanPhone } : {}),
      },
    });
  };

  return (
    <View style={styles.host}>
      <View style={styles.searchCard}>
        <Text style={[styles.label, { color: palette.tertiaryText }]}>
          YOUR STAY
        </Text>
        <Text style={[styles.body, { color: palette.secondaryText }]}>
          Check-in {detail.checkInTime.slice(0, 5)} · Check-out{" "}
          {detail.checkOutTime.slice(0, 5)}
        </Text>
        {detail.houseRules ? (
          <Text style={[styles.meta, { color: palette.tertiaryText }]}>
            House rules: {detail.houseRules}
          </Text>
        ) : null}
        <View style={styles.inputRow}>
          <Field
            label="Check-in"
            value={checkIn}
            onChange={(value) => {
              setCheckIn(value);
              onAnalytics?.("stay_search_changed", { field: "check_in" });
            }}
            palette={palette}
          />
          <Field
            label="Check-out"
            value={checkOut}
            onChange={(value) => {
              setCheckOut(value);
              onAnalytics?.("stay_search_changed", { field: "check_out" });
            }}
            palette={palette}
          />
        </View>
        <View style={styles.inputRow}>
          <Counter
            label="Adults"
            value={adults}
            minimum={1}
            maximum={20}
            palette={palette}
            onChange={setAdults}
          />
          <Counter
            label="Children"
            value={children}
            minimum={0}
            maximum={20}
            palette={palette}
            onChange={setChildren}
          />
        </View>
        <Text style={[styles.meta, { color: palette.tertiaryText }]}>
          Guest totals are distributed once across all selected Rooms and
          applied to each selected Place.
        </Text>
        {dateError ? (
          <Text style={styles.errorText}>{dateError}</Text>
        ) : null}
      </View>

      <View style={styles.tabs} accessibilityRole="tablist">
        {(["room", "place"] as const).map((kind) => {
          const selected = kind === activeKind;
          const label = kind === "room" ? "Rooms" : "Places";
          return (
            <Pressable
              key={kind}
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected }}
              onPress={() => setActiveKind(kind)}
              style={[
                styles.tab,
                surface.card,
                selected && {
                  backgroundColor: palette.accent,
                  borderColor: palette.accent,
                },
              ]}
            >
              <Text
                style={[
                  styles.tabText,
                  {
                    color: selected
                      ? palette.accentText
                      : palette.secondaryText,
                    fontFamily: theme.fontFamilyValue,
                  },
                ]}
              >
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {visibleOfferings.length === 0 ? (
        <View style={[styles.state, surface.card]}>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            No {activeKind === "room" ? "Rooms" : "Places"} are available yet.
          </Text>
        </View>
      ) : (
        visibleOfferings.map((offering) => (
          <OfferingCard
            key={offering.id}
            offering={offering}
            palette={palette}
            surface={surface}
            quantity={roomQuantities[offering.id] ?? 0}
            selectedWindowIds={placeSelections[offering.id] ?? []}
            onQuantityChange={(quantity) => {
              setRoomQuantities((current) => ({
                ...current,
                [offering.id]: quantity,
              }));
              onAnalytics?.("stay_cart_changed", {
                offering_id: offering.id,
                kind: "room",
                quantity,
              });
            }}
            onWindowSelect={(windowId) => {
              const selected =
                (placeSelections[offering.id] ?? []).includes(windowId);
              setPlaceSelections((current) => ({
                ...current,
                [offering.id]: selected
                  ? (current[offering.id] ?? []).filter((id) => id !== windowId)
                  : [...(current[offering.id] ?? []), windowId],
              }));
              onAnalytics?.("stay_cart_changed", {
                offering_id: offering.id,
                kind: "place",
                selected: !selected,
              });
            }}
            onViewed={() =>
              onAnalytics?.("stay_offering_viewed", {
                offering_id: offering.id,
                kind: offering.kind,
              })}
          />
        ))
      )}

      {selectionCount > 0 ? (
        <View style={[styles.checkout, surface.card]}>
          <Text style={[styles.heading, { color: palette.primaryText }]}>
            {selectionCount} {selectionCount === 1 ? "selection" : "selections"}
          </Text>
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            {mode === "request"
              ? "This cart includes a Request item. Nothing is charged until the Stay approves it."
              : "Mingla will confirm current inventory and show the exact all-in total before payment."}
          </Text>
          <Field
            label="Guest name"
            value={name}
            onChange={setName}
            palette={palette}
            placeholder="Your name"
          />
          <Field
            label="Email"
            value={email}
            onChange={setEmail}
            palette={palette}
            placeholder="you@example.com"
          />
          <Field
            label="Phone (optional if email is provided)"
            value={phone}
            onChange={setPhone}
            palette={palette}
            placeholder="+1 555 000 0000"
          />
          {validationError ?? roomAllocationError ?? errorMessage ? (
            <Text accessibilityRole="alert" style={styles.errorText}>
              {validationError ?? roomAllocationError ?? errorMessage}
            </Text>
          ) : null}
          <ActionButton
            label={
              submitting
                ? "Checking availability…"
                : mode === "request"
                  ? "Review request"
                  : "Review and reserve"
            }
            palette={palette}
            onPress={submit}
            disabled={submitting}
          />
        </View>
      ) : null}
    </View>
  );
}

function MoneyRow({
  label,
  amount,
  currency,
  palette,
}: {
  label: string;
  amount: string;
  currency: string;
  palette: ThemePalette;
}): React.ReactElement {
  return (
    <View style={styles.moneyRow}>
      <Text style={[styles.body, { color: palette.secondaryText }]}>{label}</Text>
      <Text style={[styles.body, { color: palette.primaryText }]}>
        {formatStayMoney(amount, currency)}
      </Text>
    </View>
  );
}

function OfferingCard({
  offering,
  palette,
  surface,
  quantity,
  selectedWindowIds,
  onQuantityChange,
  onWindowSelect,
  onViewed,
}: {
  offering: PublicStayOffering;
  palette: ThemePalette;
  surface: Surface;
  quantity: number;
  selectedWindowIds: string[];
  onQuantityChange: (quantity: number) => void;
  onWindowSelect: (windowId: string) => void;
  onViewed: () => void;
}): React.ReactElement {
  const cover = offering.media.find((media) => media.isCover) ?? offering.media[0];
  const gallery = offering.media.filter((media) => media.url !== cover?.url);
  return (
    <View
      style={[styles.offering, surface.card]}
      onLayout={onViewed}
      accessible
      accessibilityLabel={`${offering.kind === "room" ? "Room" : "Place"}: ${offering.name}`}
    >
      {cover ? (
        <Image
          source={{ uri: cover.url }}
          style={styles.cover}
          accessibilityLabel={cover.altText ?? offering.name}
        />
      ) : null}
      {gallery.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.galleryStrip}
        >
          {gallery.map((media) => (
            <Image
              key={`${media.url}:${media.sortOrder}`}
              source={{ uri: media.url }}
              style={styles.galleryImage}
              accessibilityLabel={media.altText ?? offering.name}
            />
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.offeringBody}>
        <View style={styles.titleRow}>
          <View style={styles.flex}>
            <Text style={[styles.heading, { color: palette.primaryText }]}>
              {offering.name}
            </Text>
            {offering.summary ? (
              <Text style={[styles.body, { color: palette.secondaryText }]}>
                {offering.summary}
              </Text>
            ) : null}
            {offering.description ? (
              <Text style={[styles.body, { color: palette.secondaryText }]}>
                {offering.description}
              </Text>
            ) : null}
          </View>
          <Text style={[styles.price, { color: palette.primaryText }]}>
            {formatStayMoney(
              offering.price.amountMinor,
              offering.price.currencyCode,
            )}
            {"\n"}
            <Text style={[styles.priceUnit, { color: palette.tertiaryText }]}>
              {labelForPricingUnit(offering.price.pricingUnit)}
            </Text>
          </Text>
        </View>
        <Text style={[styles.meta, { color: palette.tertiaryText }]}>
          {offering.confirmationMode === "instant" ? "Instant" : "Request"}
          {" · "}
          {offering.minGuests}–{offering.maxGuests} guests
          {offering.accessScope === "overnight_guests_only"
            ? " · Overnight guests only"
            : ""}
        </Text>
        {offering.amenities.length > 0 ? (
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            {offering.amenities.slice(0, 5).join(" · ")}
          </Text>
        ) : null}
        {offering.accessibilityFeatures.length > 0 ? (
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            Accessibility: {offering.accessibilityFeatures.join(" · ")}
          </Text>
        ) : null}
        {offering.safetyRules.length > 0 ? (
          <Text style={[styles.body, { color: palette.secondaryText }]}>
            Safety: {offering.safetyRules.join(" · ")}
          </Text>
        ) : null}
        {offering.fees.length > 0 ? (
          <Text style={[styles.meta, { color: palette.tertiaryText }]}>
            Fees shown before confirmation:{" "}
            {offering.fees
              .map((fee) =>
                `${fee.label} (${fee.displayMode === "included" ? "included" : "separate"})`
              )
              .join(", ")}
          </Text>
        ) : null}
        {offering.kind === "room" ? (
          <Counter
            label="Rooms"
            value={quantity}
            minimum={0}
            maximum={Math.min(offering.quantity ?? 10, 10)}
            palette={palette}
            onChange={onQuantityChange}
          />
        ) : (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.windows}
          >
            {offering.placeWindows.slice(0, 20).map((window) => {
              const selected = selectedWindowIds.includes(window.id);
              return (
                <Pressable
                  key={window.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Reserve ${offering.name} ${new Date(window.startsAt).toLocaleString()}`}
                  accessibilityState={{ selected }}
                  onPress={() => onWindowSelect(window.id)}
                  style={[
                    styles.window,
                    {
                      borderColor: selected ? palette.accent : palette.panelBorder,
                      backgroundColor: selected ? palette.accentWash : palette.card,
                    },
                  ]}
                >
                  <Text style={[styles.windowText, { color: palette.primaryText }]}>
                    {new Date(window.startsAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </Text>
                  <Text style={[styles.meta, { color: palette.secondaryText }]}>
                    {new Date(window.startsAt).toLocaleTimeString(undefined, {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </Text>
                  {window.priceOverrideMinor !== null ? (
                    <Text style={[styles.meta, { color: palette.primaryText }]}>
                      {formatStayMoney(
                        window.priceOverrideMinor,
                        window.currencyCode ?? offering.price.currencyCode,
                      )}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        <Text style={[styles.policy, { color: palette.tertiaryText }]}>
          {offering.policy.cancellationPolicy}
        </Text>
        {offering.policy.requestTerms ? (
          <Text style={[styles.policy, { color: palette.tertiaryText }]}>
            Request terms: {offering.policy.requestTerms}
          </Text>
        ) : null}
        {offering.policy.houseRules ? (
          <Text style={[styles.policy, { color: palette.tertiaryText }]}>
            House rules: {offering.policy.houseRules}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

function Counter({
  label,
  value,
  minimum,
  maximum,
  palette,
  onChange,
}: {
  label: string;
  value: number;
  minimum: number;
  maximum: number;
  palette: ThemePalette;
  onChange: (value: number) => void;
}): React.ReactElement {
  return (
    <View style={styles.counter}>
      <Text style={[styles.fieldLabel, { color: palette.tertiaryText }]}>
        {label}
      </Text>
      <View style={styles.counterRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Decrease ${label}`}
          disabled={value <= minimum}
          onPress={() => onChange(Math.max(minimum, value - 1))}
          style={[styles.counterButton, { borderColor: palette.panelBorder }]}
        >
          <Text style={[styles.counterButtonText, { color: palette.primaryText }]}>
            −
          </Text>
        </Pressable>
        <Text
          accessibilityLabel={`${label}: ${value}`}
          style={[styles.counterValue, { color: palette.primaryText }]}
        >
          {value}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Increase ${label}`}
          disabled={value >= maximum}
          onPress={() => onChange(Math.min(maximum, value + 1))}
          style={[styles.counterButton, { borderColor: palette.panelBorder }]}
        >
          <Text style={[styles.counterButtonText, { color: palette.primaryText }]}>
            +
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  palette,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  palette: ThemePalette;
  placeholder?: string;
}): React.ReactElement {
  return (
    <View style={styles.field}>
      <Text style={[styles.fieldLabel, { color: palette.tertiaryText }]}>
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={palette.tertiaryText}
        accessibilityLabel={label}
        autoCapitalize="none"
        style={[
          styles.textInput,
          {
            color: palette.primaryText,
            borderColor: palette.panelBorder,
            backgroundColor: palette.card,
          },
        ]}
      />
    </View>
  );
}

function ActionButton({
  label,
  palette,
  onPress,
  disabled = false,
}: {
  label: string;
  palette: ThemePalette;
  onPress: () => void;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.action,
        { backgroundColor: palette.accent },
        disabled && styles.disabled,
      ]}
    >
      <Text style={[styles.actionText, { color: palette.accentText }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  host: { gap: 18 },
  state: { minHeight: 140, padding: 20, gap: 10, justifyContent: "center" },
  searchCard: { gap: 14 },
  label: { fontSize: 11, fontWeight: "800", letterSpacing: 1.2 },
  inputRow: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  field: { flex: 1, minWidth: 140, gap: 6 },
  fieldLabel: { fontSize: 12, fontWeight: "700" },
  textInput: {
    minHeight: 46,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  counter: { flex: 1, minWidth: 140, gap: 6 },
  counterRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  counterButton: {
    width: 44,
    height: 44,
    borderWidth: 1,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  counterButtonText: { fontSize: 22, fontWeight: "700" },
  counterValue: { minWidth: 24, textAlign: "center", fontWeight: "800" },
  tabs: { flexDirection: "row", gap: 8 },
  tab: {
    minHeight: 44,
    paddingHorizontal: 18,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  tabText: { fontSize: 13, fontWeight: "800" },
  offering: { overflow: "hidden" },
  cover: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#20242c" },
  galleryStrip: { padding: 10, gap: 8 },
  galleryImage: {
    width: 132,
    height: 88,
    borderRadius: 10,
    backgroundColor: "#20242c",
  },
  offeringBody: { padding: 16, gap: 11 },
  titleRow: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  flex: { flex: 1, gap: 5 },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: "800" },
  body: { fontSize: 14, lineHeight: 20 },
  meta: { fontSize: 12, lineHeight: 17 },
  price: { textAlign: "right", fontSize: 15, fontWeight: "800" },
  total: { fontSize: 30, lineHeight: 36, fontWeight: "900" },
  moneyRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  priceUnit: { fontSize: 11, fontWeight: "500" },
  windows: { gap: 8, paddingRight: 8 },
  window: { minWidth: 112, borderWidth: 1, borderRadius: 12, padding: 10, gap: 3 },
  windowText: { fontSize: 13, fontWeight: "800" },
  policy: { fontSize: 11, lineHeight: 16 },
  checkout: { padding: 18, gap: 14 },
  errorText: { color: "#ef4444", fontSize: 13, lineHeight: 18 },
  action: {
    minHeight: 52,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  actionText: { fontSize: 15, fontWeight: "900" },
  editButton: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  editText: { fontSize: 14, fontWeight: "800" },
  disabled: { opacity: 0.55 },
});
