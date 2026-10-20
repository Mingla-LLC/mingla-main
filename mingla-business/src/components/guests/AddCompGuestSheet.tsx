/**
 * AddCompGuestSheet — issue #3827 "Add to guest list".
 *
 * A host puts people on the guest list without checkout. Each person gets a
 * REAL free ticket with a QR code, emailed through the standard free-ticket
 * confirmation. Guest-list tickets take a place (capacity, going) but are never
 * sales.
 *
 * Rows: Name*, Email, Phone, and named plus-ones. A plus-one with a name is
 * their own ticket and email; a blank plus-one is one extra ticket in the
 * guest's own email. Paste mode turns "Name, email, party size" lines into rows.
 *
 * Server: guest-list edge function `issue` → biz_comp_issue. One
 * clientRequestId per submission, reused on every retry, so nobody is added
 * twice. Capacity is all-or-nothing for the batch; everything else is per
 * person, so a partial failure leaves only the refused people in the sheet.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
// ORCH-0892-B v2: ScrollView via SmartScrollView wrapper. Per SPEC §7.F.
import { ScrollView } from "../../wrappers/SmartScrollView";

import {
  accent,
  glass,
  radius as radiusTokens,
  semantic,
  spacing,
  text as textTokens,
} from "../../constants/designSystem";
import type { LiveEvent } from "../../store/liveEventStore";
import type { TicketStub } from "../../store/draftEventStore";
import type { OrderRecord } from "../../store/orderStore";
import { eventOrdersKeys, useEventOrders } from "../../hooks/useEventOrders";
import { guestRosterKeys } from "../../hooks/useGuestRoster";
import { usePublicEventById } from "../../hooks/usePublicEvents";
import { useCurrentBrandRole } from "../../hooks/useCurrentBrandRole";
import { canPerformAction, gateCaptionFor } from "../../utils/permissionGates";
import { formatOccurrenceDayLabel } from "../../utils/eventDateDisplay";
import { isPerNightCapacity } from "../../utils/perNightCapacity";
import { phoneStartCountryForCurrency } from "../../utils/phoneStartCountryForCurrency";
import type {
  GuestListGuestInput,
  GuestListIssueResponse,
  GuestListIssueResult,
} from "../../services/guestListService";

import { Button } from "../ui/Button";
import { Pill } from "../ui/Pill";
import { PhoneField, usePhoneEntry } from "../ui/PhoneField";
import { Sheet } from "../ui/Sheet";

// issue #3827 — the guest-list client loads on first use, so it stays out of
// the business-web boot chunk (__common ceiling, orch-1083).
const loadGuestList = () => import("../../services/guestListService");
const FALLBACK_COPY = "Something went wrong. Nothing was charged. Try again. Guests already added won't be added twice.";
const guestListMessage = (error: unknown, fallback: string = FALLBACK_COPY): string =>
  error instanceof Error && error.name === "GuestListError" ? error.message : fallback;

const MAX_GUESTS = 50;
const MAX_PLUS_ONES = 9;
const NAME_MAX = 120;
const EMAIL_MAX = 200;
const NOTE_MAX = 200;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** A device-only comp from before #3827, offered for Re-add. */
export interface LegacyCompPrefill {
  localId: string;
  name: string;
  email: string;
  phone: string;
}

export interface AddCompGuestSuccess {
  /** The toast the parent shows. */
  message: string;
  /** Legacy entries that are now real tickets (remove them from the phone). */
  addedLegacyIds: string[];
}

export interface AddCompGuestSheetProps {
  visible: boolean;
  event: LiveEvent;
  brandId: string;
  prefill?: LegacyCompPrefill[];
  onClose: () => void;
  onSuccess: (result: AddCompGuestSuccess) => void;
}

// ---- Row model -------------------------------------------------------------

interface PhoneValue {
  e164: string | null;
  isEmpty: boolean;
}

interface PersonDraft {
  key: string;
  name: string;
  email: string;
  phone: PhoneValue;
  initialPhone: string;
  /** Set once the server answered for this person. */
  outcome: "added" | "failed" | null;
  failCopy: string | null;
}

interface GuestDraft extends PersonDraft {
  /** Frozen at the first submit, so a retry replays the same people. */
  index: number | null;
  plusOnes: PersonDraft[];
  legacyId: string | null;
}

let keySeq = 0;
const nextKey = (): string => {
  keySeq += 1;
  return `r${keySeq}`;
};

const emptyPerson = (seed?: Partial<PersonDraft>): PersonDraft => ({
  key: nextKey(),
  name: seed?.name ?? "",
  email: seed?.email ?? "",
  phone: { e164: null, isEmpty: (seed?.initialPhone ?? "").trim().length === 0 },
  initialPhone: seed?.initialPhone ?? "",
  outcome: null,
  failCopy: null,
});

const emptyGuest = (seed?: { name?: string; email?: string; phone?: string; plusOnes?: number; legacyId?: string }): GuestDraft => ({
  ...emptyPerson({ name: seed?.name, email: seed?.email, initialPhone: seed?.phone }),
  index: null,
  plusOnes: Array.from({ length: seed?.plusOnes ?? 0 }, () => emptyPerson()),
  legacyId: seed?.legacyId ?? null,
});

const newRequestId = (): string => {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoLike?.randomUUID) return cryptoLike.randomUUID();
  // RFC 4122 v4 shape from Math.random — only on runtimes without randomUUID.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
};

const trimmedEmail = (person: PersonDraft): string => person.email.trim().toLowerCase();
const isBlankPerson = (person: PersonDraft): boolean =>
  person.name.trim() === "" && person.email.trim() === "" && person.phone.isEmpty;

// ---- Validation -----------------------------------------------------------

interface PersonErrors {
  name: string | null;
  email: string | null;
  phone: string | null;
  plusOne: string | null;
  twice: string | null;
}

const NO_ERRORS: PersonErrors = { name: null, email: null, phone: null, plusOne: null, twice: null };

export const validatePerson = (person: PersonDraft, isPlusOne: boolean): PersonErrors => {
  const name = person.name.trim();
  const email = trimmedEmail(person);
  const out: PersonErrors = { ...NO_ERRORS };
  if (isPlusOne) {
    if (name === "" && (email !== "" || !person.phone.isEmpty)) {
      out.plusOne = "Add their name, or leave all three empty.";
    }
  } else if (name === "") {
    out.name = "Enter a name.";
  }
  if (name.length > NAME_MAX) out.name = "Keep the name under 120 characters.";
  if (email !== "" && (email.length > EMAIL_MAX || !EMAIL_RE.test(email))) {
    out.email = "That email doesn't look right.";
  }
  if (!person.phone.isEmpty && person.phone.e164 === null) {
    out.phone = "Use a full phone number with country code.";
  }
  return out;
};

const hasError = (errors: PersonErrors): boolean =>
  errors.name !== null || errors.email !== null || errors.phone !== null ||
  errors.plusOne !== null || errors.twice !== null;

/** People a guest row brings: the guest, their named plus-ones, blank plus-ones. */
const peopleInGuest = (guest: GuestDraft): number => 1 + guest.plusOnes.length;

// ---- Paste mode ------------------------------------------------------------

export interface PasteParse {
  guests: Array<{ name: string; email: string; partySize: number }>;
  errors: string[];
}

export const parseGuestPaste = (text: string): PasteParse => {
  const guests: PasteParse["guests"] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === "") return;
    const parts = line.split(/[,\t;]/).map((p) => p.trim());
    const name = parts[0] ?? "";
    const email = (parts[1] ?? "").toLowerCase();
    const partyRaw = parts[2] ?? "";
    const lineNo = i + 1;
    if (name === "") {
      errors.push(`Line ${lineNo}: add a name`);
      return;
    }
    if (email !== "" && !EMAIL_RE.test(email)) {
      errors.push(`Line ${lineNo}: that email doesn't look right`);
      return;
    }
    let partySize = 1;
    if (partyRaw !== "") {
      const n = Number(partyRaw);
      if (!Number.isInteger(n) || n < 1 || n > MAX_PLUS_ONES + 1) {
        errors.push(`Line ${lineNo}: party size is 1 to 10`);
        return;
      }
      partySize = n;
    }
    guests.push({ name, email, partySize });
  });
  return { guests, errors };
};

// ---- Capacity --------------------------------------------------------------

const liveTicketStatuses = new Set(["valid", "used"]);

/** Places already issued on a tier (sales + guest list), per night when asked. */
const issuedOnTier = (
  orders: OrderRecord[],
  ticketTypeId: string,
  eventDateId: string | null,
): number => {
  let count = 0;
  for (const order of orders) {
    if (order.status !== "paid" && order.status !== "refunded_partial") continue;
    const passes = order.ticketDays ?? [];
    if (passes.length > 0) {
      for (const pass of passes) {
        if (pass.ticketTypeId !== ticketTypeId || !liveTicketStatuses.has(pass.status)) continue;
        if (eventDateId !== null && pass.eventDateIds.length > 0 && !pass.eventDateIds.includes(eventDateId)) {
          continue;
        }
        count += 1;
      }
      continue;
    }
    for (const line of order.lines) {
      if (line.ticketTypeId !== ticketTypeId) continue;
      count += Math.max(0, line.quantity - line.refundedQuantity);
    }
  }
  return count;
};

const remainingFor = (
  ticket: TicketStub,
  orders: OrderRecord[],
  eventDateId: string | null,
): number | null => {
  if (ticket.isUnlimited || ticket.capacity === null) return null;
  return Math.max(0, ticket.capacity - issuedOnTier(orders, ticket.id, eventDateId));
};

// ---- PersonFields ----------------------------------------------------------

interface PersonFieldsProps {
  person: PersonDraft;
  isPlusOne: boolean;
  heading: string;
  guestName: string;
  errors: PersonErrors;
  showErrors: boolean;
  disabled: boolean;
  currency: string | null;
  onChange: (patch: Partial<PersonDraft>) => void;
  onRemove: (() => void) | null;
}

const PersonFields: React.FC<PersonFieldsProps> = ({
  person,
  isPlusOne,
  heading,
  guestName,
  errors,
  showErrors,
  disabled,
  currency,
  onChange,
  onRemove,
}) => {
  const phone = usePhoneEntry({ startCountries: [phoneStartCountryForCurrency(currency)] });
  const setPhoneText = phone.setText;
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (person.initialPhone.trim() !== "") setPhoneText(person.initialPhone.trim());
  }, [person.initialPhone, setPhoneText]);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => {
    onChangeRef.current({ phone: { e164: phone.e164, isEmpty: phone.isEmpty } });
  }, [phone.e164, phone.isEmpty]);

  if (person.outcome === "added") {
    return (
      <View style={isPlusOne ? styles.plusOneCard : styles.guestCard} testID={`comp-added-${person.key}`}>
        <Text style={styles.addedLine}>✓ Added</Text>
        <Text style={styles.addedName}>{person.name.trim() === "" ? `Plus-one of ${guestName}` : person.name}</Text>
      </View>
    );
  }

  const blank = isPlusOne && isBlankPerson(person);
  const nameOnly = person.name.trim() !== "" && trimmedEmail(person) === "";
  let caption: string | null = null;
  if (isPlusOne && blank) {
    caption = `No name: their QR code goes in ${guestName.trim() === "" ? "this guest" : guestName.trim()}'s email.`;
  } else if (nameOnly) {
    caption = isPlusOne
      ? "No email: door staff can find them by name."
      : "No email: they won't get a ticket by email. Door staff can find them by name.";
  }

  return (
    <View style={isPlusOne ? styles.plusOneCard : styles.guestCard}>
      <View style={styles.cardHead}>
        <Text style={styles.cardTitle}>{heading}</Text>
        {onRemove !== null ? (
          <Pressable
            onPress={onRemove}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Remove ${heading.toLowerCase()}`}
            hitSlop={12}
            style={styles.removeHit}
          >
            <Text style={styles.removeText}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
      {person.failCopy !== null ? <Text style={styles.errorText}>{person.failCopy}</Text> : null}
      {errors.plusOne !== null && showErrors ? <Text style={styles.errorText}>{errors.plusOne}</Text> : null}
      <View style={styles.fieldGroup}>
        <View style={[styles.inputWrap, showErrors && errors.name !== null && styles.inputError]}>
          <TextInput
            value={person.name}
            onChangeText={(name) => onChange({ name, failCopy: null })}
            placeholder={isPlusOne ? "Name (optional)" : "Full name"}
            placeholderTextColor={textTokens.quaternary}
            maxLength={NAME_MAX}
            style={styles.input}
            editable={!disabled}
            accessibilityLabel={isPlusOne ? `${heading} name` : "Full name"}
          />
        </View>
        {showErrors && errors.name !== null ? <Text style={styles.errorText}>{errors.name}</Text> : null}
      </View>
      <View style={styles.fieldGroup}>
        <View
          style={[
            styles.inputWrap,
            ((showErrors || trimmedEmail(person).length > 4) && errors.email !== null) || errors.twice !== null
              ? styles.inputError
              : null,
          ]}
        >
          <TextInput
            value={person.email}
            onChangeText={(email) => onChange({ email, failCopy: null })}
            placeholder={isPlusOne ? "Email (optional, sends their own ticket)" : "Email (sends their ticket)"}
            placeholderTextColor={textTokens.quaternary}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={EMAIL_MAX}
            style={styles.input}
            editable={!disabled}
            accessibilityLabel={isPlusOne ? `${heading} email` : "Email"}
          />
        </View>
        {(showErrors || trimmedEmail(person).length > 4) && errors.email !== null ? (
          <Text style={styles.errorText}>{errors.email}</Text>
        ) : null}
        {errors.twice !== null ? <Text style={styles.errorText}>{errors.twice}</Text> : null}
      </View>
      <View style={styles.fieldGroup}>
        <PhoneField
          entry={phone}
          placeholder="Phone (optional)"
          accessibilityLabel={isPlusOne ? `${heading} phone` : "Phone (optional)"}
          disabled={disabled}
          showErrors={showErrors}
        />
      </View>
      {caption !== null ? <Text style={styles.caption}>{caption}</Text> : null}
    </View>
  );
};

// ---- Sheet -------------------------------------------------------------------

type Mode = "rows" | "paste";

export const AddCompGuestSheet: React.FC<AddCompGuestSheetProps> = ({
  visible,
  event,
  brandId,
  prefill,
  onClose,
  onSuccess,
}) => {
  const eventId = event.serverEventId ?? event.id;
  const queryClient = useQueryClient();
  const ordersRead = useEventOrders(visible ? eventId : null);
  const orders = useMemo<OrderRecord[]>(() => ordersRead.data ?? [], [ordersRead.data]);
  const publicEvent = usePublicEventById(visible ? eventId : null);
  const { rank } = useCurrentBrandRole(brandId);
  const canAdd = canPerformAction(rank, "ADD_COMP_GUEST");
  const currency = event.currency ?? null;

  const [guests, setGuests] = useState<GuestDraft[]>([emptyGuest()]);
  const [mode, setMode] = useState<Mode>("rows");
  const [pasteText, setPasteText] = useState<string>("");
  const [pasteErrors, setPasteErrors] = useState<string[]>([]);
  const [note, setNote] = useState<string>("");
  const [ticketTypeId, setTicketTypeId] = useState<string | null>(null);
  const [eventDateId, setEventDateId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [showErrors, setShowErrors] = useState<boolean>(false);
  const [banner, setBanner] = useState<{ kind: "error" | "warn"; text: string } | null>(null);
  const requestIdRef = useRef<string>(newRequestId());
  const submittedOnce = useRef<boolean>(false);

  // Fresh sheet on every open (prefilled when Re-add opened it).
  useEffect(() => {
    if (!visible) return;
    requestIdRef.current = newRequestId();
    submittedOnce.current = false;
    setGuests(
      prefill !== undefined && prefill.length > 0
        ? prefill.slice(0, MAX_GUESTS).map((p) =>
          emptyGuest({ name: p.name, email: p.email, phone: p.phone, legacyId: p.localId }))
        : [emptyGuest()],
    );
    setMode("rows");
    setPasteText("");
    setPasteErrors([]);
    setNote("");
    setTicketTypeId(null);
    setEventDateId(null);
    setSubmitting(false);
    setShowErrors(false);
    setBanner(null);
  }, [visible, prefill]);

  // Every non-deleted tier, hidden ones too (a comp is a host grant, not a sale).
  const tiers = useMemo<TicketStub[]>(
    () => [...event.tickets].sort((a, b) => a.displayOrder - b.displayOrder),
    [event.tickets],
  );

  const upcoming = useMemo(
    () => (publicEvent.data?.occurrences ?? []).filter((o) => new Date(o.endAt).getTime() > Date.now()),
    [publicEvent.data?.occurrences],
  );
  const needsDate = upcoming.length > 1;
  const perNight = isPerNightCapacity(event.whenMode);
  const capacityDate = perNight ? eventDateId ?? (upcoming.length === 1 ? upcoming[0].id : null) : null;
  // A recurring event's places are per night: until a night is picked there is
  // no honest "left" number, so none is shown (the server still checks).
  const awaitingNight = perNight && needsDate && eventDateId === null;

  const remainingByTier = useMemo<Map<string, number | null>>(() => {
    const map = new Map<string, number | null>();
    for (const tier of tiers) {
      map.set(tier.id, awaitingNight ? null : remainingFor(tier, orders, capacityDate));
    }
    return map;
  }, [tiers, orders, capacityDate, awaitingNight]);

  // Default: a tier named like "guest list", else the first with room.
  useEffect(() => {
    if (!visible || ticketTypeId !== null || tiers.length === 0) return;
    const hasRoom = (t: TicketStub): boolean => {
      const left = remainingByTier.get(t.id);
      return left === null || left === undefined || left > 0;
    };
    const named = tiers.find((t) => /guest\s*-?\s*list/i.test(t.name) && hasRoom(t));
    const first = named ?? tiers.find(hasRoom) ?? null;
    if (first !== null) setTicketTypeId(first.id);
  }, [visible, ticketTypeId, tiers, remainingByTier]);

  const tier = tiers.find((t) => t.id === ticketTypeId) ?? null;
  const remaining = tier === null ? null : remainingByTier.get(tier.id) ?? null;

  // ---- derived validation ----
  const errorsByKey = useMemo<Map<string, PersonErrors>>(() => {
    const map = new Map<string, PersonErrors>();
    const seen = new Map<string, string>();
    for (const guest of guests) {
      const people: Array<[PersonDraft, boolean]> = [[guest, false], ...guest.plusOnes.map((p): [PersonDraft, boolean] => [p, true])];
      for (const [person, isPlusOne] of people) {
        const errors = person.outcome === "added" ? { ...NO_ERRORS } : validatePerson(person, isPlusOne);
        const email = trimmedEmail(person);
        if (email !== "" && person.outcome !== "added") {
          if (seen.has(email)) errors.twice = "Listed twice.";
          else seen.set(email, person.key);
        }
        map.set(person.key, errors);
      }
    }
    return map;
  }, [guests]);
  const anyErrors = [...errorsByKey.values()].some(hasError);

  // People this submit will try to add.
  const peopleToSend = guests.reduce((sum, guest) => {
    if (guest.outcome === "added") {
      return sum + guest.plusOnes.filter((p) => p.outcome === "failed" && p.name.trim() !== "").length;
    }
    return sum + peopleInGuest(guest);
  }, 0);
  const overCapacity = remaining !== null && peopleToSend > remaining;
  const isRetry = submittedOnce.current && guests.some((g) => g.outcome === "failed" || g.plusOnes.some((p) => p.outcome === "failed"));

  const dateOk = !needsDate || eventDateId !== null;
  const canSubmit =
    canAdd && !submitting && mode === "rows" && tier !== null && dateOk &&
    !anyErrors && peopleToSend > 0 && !overCapacity;

  // ---- row editing ----
  const patchGuest = useCallback((key: string, patch: Partial<GuestDraft>): void => {
    setGuests((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }, []);
  const patchPlusOne = useCallback((guestKey: string, key: string, patch: Partial<PersonDraft>): void => {
    setGuests((prev) =>
      prev.map((g) =>
        g.key !== guestKey ? g : { ...g, plusOnes: g.plusOnes.map((p) => (p.key === key ? { ...p, ...patch } : p)) },
      ));
  }, []);
  const addGuest = (): void => {
    setGuests((prev) => (prev.length >= MAX_GUESTS ? prev : [...prev, emptyGuest()]));
  };
  const removeGuest = (key: string): void => {
    setGuests((prev) => (prev.length <= 1 ? prev : prev.filter((g) => g.key !== key)));
  };
  const addPlusOne = (key: string): void => {
    setGuests((prev) =>
      prev.map((g) =>
        g.key !== key || g.plusOnes.length >= MAX_PLUS_ONES ? g : { ...g, plusOnes: [...g.plusOnes, emptyPerson()] },
      ));
  };
  const removePlusOne = (guestKey: string, key: string): void => {
    setGuests((prev) =>
      prev.map((g) => (g.key !== guestKey ? g : { ...g, plusOnes: g.plusOnes.filter((p) => p.key !== key) })));
  };

  const handlePreview = (): void => {
    const parsed = parseGuestPaste(pasteText);
    setPasteErrors(parsed.errors);
    if (parsed.guests.length === 0) return;
    const rows = parsed.guests.slice(0, MAX_GUESTS).map((g) =>
      emptyGuest({ name: g.name, email: g.email, plusOnes: g.partySize - 1 }));
    setGuests((prev) => {
      const kept = prev.filter((g) => !isBlankPerson(g) || g.plusOnes.length > 0);
      return [...kept, ...rows].slice(0, MAX_GUESTS);
    });
    if (parsed.errors.length === 0) setMode("rows");
  };

  // ---- submit ----
  const handleSubmit = useCallback(async (): Promise<void> => {
    setShowErrors(true);
    if (!canSubmit || tier === null) return;
    // Freeze indexes on the first submit; later rows take the smallest free one.
    const used = new Set(guests.map((g) => g.index).filter((i): i is number => i !== null));
    const indexed = guests.map((g) => {
      if (g.index !== null) return g;
      let i = 0;
      while (used.has(i)) i += 1;
      used.add(i);
      return { ...g, index: i };
    });
    setGuests(indexed);
    const toSend = indexed.filter(
      (g) => g.outcome !== "added" || g.plusOnes.some((p) => p.outcome === "failed"),
    );
    const payload: GuestListGuestInput[] = toSend.map((g) => ({
      index: g.index as number,
      name: g.name.trim(),
      email: trimmedEmail(g) === "" ? null : trimmedEmail(g),
      phoneE164: g.phone.e164,
      plusOnes: g.plusOnes.map((p) => ({
        name: p.name.trim() === "" ? null : p.name.trim(),
        email: trimmedEmail(p) === "" ? null : trimmedEmail(p),
        phoneE164: p.phone.e164,
      })),
    }));
    submittedOnce.current = true;
    setSubmitting(true);
    setBanner(null);
    let response: GuestListIssueResponse;
    let failureCopy: (code: GuestListIssueResult["code"]) => string;
    try {
      const svc = await loadGuestList();
      failureCopy = svc.guestListIssueFailureCopy;
      response = await svc.issueGuestListTickets({
        eventId,
        ticketTypeId: tier.id,
        eventDateId: needsDate ? eventDateId : null,
        guests: payload,
        note: note.trim() === "" ? null : note.trim(),
        clientRequestId: requestIdRef.current,
      });
    } catch (error) {
      setSubmitting(false);
      setBanner({
        kind: "error",
        text: guestListMessage(error),
      });
      return;
    }

    void queryClient.invalidateQueries({ queryKey: eventOrdersKeys.all });
    void queryClient.invalidateQueries({ queryKey: [...guestRosterKeys.all, eventId] });

    const resultFor = (index: number, plusOneIndex: number | null): GuestListIssueResult | undefined =>
      response.results.find((r) => r.index === index && (r.plusOneIndex ?? null) === plusOneIndex);
    const nextGuests = indexed.map((g) => {
      if (!toSend.includes(g)) return g;
      const own = resultFor(g.index as number, null);
      const ownOk = own !== undefined && own.status !== "failed";
      return {
        ...g,
        outcome: ownOk ? ("added" as const) : ("failed" as const),
        failCopy: ownOk ? null : failureCopy(own?.code ?? null),
        plusOnes: g.plusOnes.map((p, i) => {
          if (p.name.trim() === "") return { ...p, outcome: ownOk ? ("added" as const) : p.outcome };
          const r = resultFor(g.index as number, i);
          const ok = r !== undefined && r.status !== "failed";
          return { ...p, outcome: ok ? ("added" as const) : ("failed" as const), failCopy: ok ? null : failureCopy(r?.code ?? null) };
        }),
      };
    });
    setGuests(nextGuests);
    setSubmitting(false);

    const failed = response.results.filter((r) => r.status === "failed").length;
    const added = response.results.length - failed;
    if (failed > 0) {
      setBanner({ kind: "warn", text: `${added} added, ${failed} couldn't be added.` });
      return;
    }
    const addedLegacyIds = nextGuests
      .filter((g) => g.outcome === "added" && g.legacyId !== null)
      .map((g) => g.legacyId as string);
    onSuccess({ message: successToast(nextGuests, response), addedLegacyIds });
  }, [canSubmit, tier, guests, eventId, needsDate, eventDateId, note, queryClient, onSuccess]);

  const handleClose = useCallback((): void => {
    if (submitting) return;
    onClose();
  }, [submitting, onClose]);

  const peopleLabel = `${peopleToSend} guest${peopleToSend === 1 ? "" : "s"}`;
  const primaryLabel = submitting ? "Adding…" : isRetry ? "Try again" : `Add ${peopleLabel}`;
  const structureLocked = submittedOnce.current;

  return (
    <Sheet visible={visible} onClose={handleClose} snapPoint="full">
      <View style={styles.body}>
        <Text style={styles.title} accessibilityRole="header">Add to guest list</Text>
        <Text style={styles.subhead}>
          {"They get a free ticket with a QR code by email. Guest-list tickets take a place but aren't sales."}
        </Text>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
        >
          {banner !== null ? (
            <View style={[styles.banner, banner.kind === "error" ? styles.bannerError : styles.bannerWarn]} accessibilityLiveRegion="polite">
              <Text style={styles.bannerText}>{banner.text}</Text>
            </View>
          ) : null}

          {/* Ticket type */}
          <Text style={styles.label}>Ticket type</Text>
          <View style={styles.chipRow}>
            {tiers.map((t) => {
              const left = remainingByTier.get(t.id) ?? null;
              const soldOut = left !== null && left <= 0;
              const selected = t.id === ticketTypeId;
              const sub = awaitingNight && !t.isUnlimited && t.capacity !== null
                ? "Pick a date"
                : left === null ? "Unlimited" : soldOut ? "Sold out" : `${left} left`;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setTicketTypeId(t.id)}
                  disabled={soldOut || submitting || structureLocked}
                  style={[styles.tierChip, selected && styles.tierChipActive, soldOut && styles.tierChipDisabled]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected, disabled: soldOut }}
                  accessibilityLabel={`${t.name}, ${sub}${t.visibility === "hidden" ? ", hidden" : ""}`}
                >
                  <View style={styles.tierChipHead}>
                    <Text style={[styles.tierChipLabel, selected && styles.tierChipLabelActive]}>{t.name}</Text>
                    {t.visibility === "hidden" ? <Pill variant="draft">HIDDEN</Pill> : null}
                  </View>
                  <Text style={styles.tierChipSub}>{sub}</Text>
                </Pressable>
              );
            })}
          </View>
          {tier !== null && remaining !== null && remaining <= 0 ? (
            <Text style={styles.caption}>Sold out. Raise capacity to add guests here.</Text>
          ) : null}
          {overCapacity && tier !== null ? (
            <View style={[styles.banner, styles.bannerError]}>
              <Text style={styles.bannerText}>{`Only ${remaining ?? 0} places left on ${tier.name}.`}</Text>
            </View>
          ) : null}

          {/* Date (only when the event needs one) */}
          {needsDate ? (
            <>
              <Text style={styles.label}>Date</Text>
              <View style={styles.chipRow}>
                {upcoming.map((occ) => {
                  const label = formatOccurrenceDayLabel(occ.startAt, occ.timezone) ?? occ.startAt.slice(0, 10);
                  const selected = occ.id === eventDateId;
                  return (
                    <Pressable
                      key={occ.id}
                      onPress={() => setEventDateId(occ.id)}
                      disabled={submitting || structureLocked}
                      style={[styles.tierChip, selected && styles.tierChipActive]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      accessibilityLabel={label}
                    >
                      <Text style={[styles.tierChipLabel, selected && styles.tierChipLabelActive]}>{label}</Text>
                    </Pressable>
                  );
                })}
              </View>
              {showErrors && eventDateId === null ? (
                <Text style={styles.errorText}>{"Pick which date they're coming."}</Text>
              ) : null}
            </>
          ) : null}

          {/* Guests */}
          {mode === "paste" ? (
            <View style={styles.fieldGroup}>
              <Text style={styles.label}>Paste a list</Text>
              <View style={styles.inputWrap}>
                <TextInput
                  value={pasteText}
                  onChangeText={setPasteText}
                  placeholder="One guest per line: Name, email, party size"
                  placeholderTextColor={textTokens.quaternary}
                  multiline
                  numberOfLines={6}
                  autoCapitalize="none"
                  autoCorrect={false}
                  style={[styles.input, styles.inputMultiline]}
                  accessibilityLabel="Paste a list"
                />
              </View>
              {pasteErrors.map((err) => (
                <Text key={err} style={styles.errorText}>{err}</Text>
              ))}
              <View style={styles.inlineButtons}>
                <Button label="Preview" onPress={handlePreview} variant="secondary" size="sm" accessibilityLabel="Preview the pasted guests" />
                <Button label="Back to rows" onPress={() => setMode("rows")} variant="ghost" size="sm" accessibilityLabel="Back to guest rows" />
              </View>
            </View>
          ) : (
            <>
              {guests.map((guest, gi) => (
                <View key={guest.key}>
                  <PersonFields
                    person={guest}
                    isPlusOne={false}
                    heading={`Guest ${gi + 1}`}
                    guestName={guest.name}
                    errors={errorsByKey.get(guest.key) ?? NO_ERRORS}
                    showErrors={showErrors}
                    disabled={submitting}
                    currency={currency}
                    onChange={(patch) => patchGuest(guest.key, patch)}
                    onRemove={guests.length > 1 && !submitting && guest.outcome !== "added" ? () => removeGuest(guest.key) : null}
                  />
                  {guest.plusOnes.map((p, pi) => (
                    <PersonFields
                      key={p.key}
                      person={p}
                      isPlusOne
                      heading={`Plus-one ${pi + 1}`}
                      guestName={guest.name}
                      errors={errorsByKey.get(p.key) ?? NO_ERRORS}
                      showErrors={showErrors}
                      disabled={submitting || (guest.outcome === "added" && p.outcome !== "failed")}
                      currency={currency}
                      onChange={(patch) => patchPlusOne(guest.key, p.key, patch)}
                      onRemove={!structureLocked && !submitting ? () => removePlusOne(guest.key, p.key) : null}
                    />
                  ))}
                  {guest.outcome !== "added" && !structureLocked ? (
                    guest.plusOnes.length < MAX_PLUS_ONES ? (
                      <Pressable
                        onPress={() => addPlusOne(guest.key)}
                        disabled={submitting}
                        style={styles.textButton}
                        accessibilityRole="button"
                        accessibilityLabel={`Add a plus-one for guest ${gi + 1}`}
                      >
                        <Text style={styles.textButtonLabel}>+ Add a plus-one</Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.caption}>Up to 9 plus-ones per guest.</Text>
                    )
                  ) : null}
                </View>
              ))}
              {!structureLocked ? (
                <View style={styles.inlineButtons}>
                  {guests.length < MAX_GUESTS ? (
                    <Pressable onPress={addGuest} disabled={submitting} style={styles.textButton} accessibilityRole="button" accessibilityLabel="Add another guest">
                      <Text style={styles.textButtonLabel}>+ Add another guest</Text>
                    </Pressable>
                  ) : null}
                  <Pressable onPress={() => setMode("paste")} disabled={submitting} style={styles.textButton} accessibilityRole="button" accessibilityLabel="Paste a list">
                    <Text style={styles.textButtonLabel}>Paste a list</Text>
                  </Pressable>
                </View>
              ) : null}
            </>
          )}

          {/* Note */}
          <View style={styles.fieldGroup}>
            <Text style={styles.label}>Note for your team</Text>
            <View style={[styles.inputWrap, note.length > NOTE_MAX && styles.inputError]}>
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="Why are they on the list? Only your team sees this."
                placeholderTextColor={textTokens.quaternary}
                multiline
                numberOfLines={2}
                maxLength={NOTE_MAX}
                style={[styles.input, styles.inputMultiline]}
                editable={!submitting && !structureLocked}
                accessibilityLabel="Note for your team"
              />
            </View>
          </View>
        </ScrollView>

        <View style={styles.actions}>
          <Button
            label={primaryLabel}
            onPress={handleSubmit}
            variant="primary"
            size="lg"
            fullWidth
            loading={submitting}
            disabled={!canSubmit}
            accessibilityLabel={primaryLabel}
            testID="comp-submit"
          />
          {!canAdd ? <Text style={styles.gateCaption}>{gateCaptionFor("ADD_COMP_GUEST")}</Text> : null}
        </View>
      </View>
    </Sheet>
  );
};

const successToast = (guests: GuestDraft[], response: GuestListIssueResponse): string => {
  const sent = guests.filter((g) => g.outcome === "added");
  const emailed = response.results.some((r) => r.status === "added" && r.emailQueued);
  if (sent.length === 1) {
    const g = sent[0];
    const plusOnes = g.plusOnes.length;
    if (plusOnes > 0) {
      return `${g.name.trim()} and ${plusOnes} plus-one${plusOnes === 1 ? "" : "s"} are on the guest list. Tickets emailed.`;
    }
    return trimmedEmail(g) === ""
      ? `${g.name.trim()} is on the guest list. No email: find them by name at the door.`
      : `${g.name.trim()} is on the guest list. Ticket emailed.`;
  }
  const people = sent.reduce((sum, g) => sum + peopleInGuest(g), 0);
  return emailed
    ? `${people} guests added. Tickets emailed.`
    : `${people} guests added. No emails: find them by name at the door.`;
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: "700",
    color: textTokens.primary,
    letterSpacing: -0.2,
    marginBottom: spacing.xs,
  },
  subhead: {
    fontSize: 14,
    color: textTokens.secondary,
    lineHeight: 20,
    marginBottom: spacing.md,
  },
  scroll: {
    flex: 1,
    marginBottom: spacing.md,
  },
  scrollContent: {
    paddingBottom: spacing.sm,
  },
  label: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.secondary,
    marginBottom: 6,
    marginTop: spacing.sm,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: spacing.sm,
  },
  tierChip: {
    minHeight: 44,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
    justifyContent: "center",
  },
  tierChipActive: {
    backgroundColor: accent.tint,
    borderColor: accent.border,
  },
  tierChipDisabled: {
    opacity: 0.45,
  },
  tierChipHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  tierChipLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: textTokens.primary,
  },
  tierChipLabelActive: {
    color: textTokens.primary,
  },
  tierChipSub: {
    fontSize: 11,
    color: textTokens.tertiary,
    marginTop: 2,
  },
  guestCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    backgroundColor: glass.tint.profileBase,
  },
  plusOneCard: {
    marginTop: spacing.xs,
    marginLeft: 16,
    padding: spacing.md,
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: spacing.xs,
  },
  cardTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: textTokens.primary,
  },
  removeHit: {
    minHeight: 44,
    justifyContent: "center",
  },
  removeText: {
    fontSize: 13,
    fontWeight: "600",
    color: accent.warm,
  },
  addedLine: {
    fontSize: 13,
    fontWeight: "700",
    color: textTokens.primary,
  },
  addedName: {
    fontSize: 13,
    color: textTokens.secondary,
    marginTop: 2,
  },
  fieldGroup: {
    marginBottom: spacing.sm,
  },
  inputWrap: {
    backgroundColor: glass.tint.profileBase,
    borderWidth: 1,
    borderColor: glass.border.profileBase,
    borderRadius: radiusTokens.md,
    overflow: "hidden",
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: 4,
  },
  inputError: {
    borderColor: semantic.error,
  },
  input: {
    fontSize: 15,
    color: textTokens.primary,
    minHeight: 40,
    paddingVertical: 6,
  },
  inputMultiline: {
    minHeight: 72,
    textAlignVertical: "top",
  },
  errorText: {
    fontSize: 12,
    color: semantic.error,
    marginTop: 4,
  },
  caption: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 4,
    marginBottom: spacing.xs,
  },
  textButton: {
    minHeight: 44,
    justifyContent: "center",
    paddingRight: spacing.md,
  },
  textButtonLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: accent.warm,
  },
  inlineButtons: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  banner: {
    borderRadius: radiusTokens.md,
    borderWidth: 1,
    padding: spacing.sm + 2,
    marginBottom: spacing.sm,
  },
  bannerError: {
    borderColor: semantic.error,
    backgroundColor: "rgba(239, 68, 68, 0.12)",
  },
  bannerWarn: {
    borderColor: accent.warm,
    backgroundColor: "rgba(235, 120, 37, 0.12)",
  },
  bannerText: {
    fontSize: 13,
    color: textTokens.primary,
    lineHeight: 18,
  },
  actions: {
    paddingTop: spacing.sm,
  },
  gateCaption: {
    fontSize: 12,
    color: textTokens.tertiary,
    marginTop: 6,
    textAlign: "center",
  },
});

export default AddCompGuestSheet;
