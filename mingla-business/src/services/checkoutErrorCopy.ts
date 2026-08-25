/**
 * issue #2337 [free checkout says "no more tickets" for any conflict] — the ONE
 * module that turns a `ticket-checkout-create` refusal into FREE-rail guest copy.
 *
 * WHY IT IS ITS OWN FILE, AND WHY IT IMPORTS NOTHING.
 *
 * Before #2337 the free mapper lived inside `ticketCheckoutService.ts`, which
 * imports the Supabase browser client. That made the mapper unreachable from a
 * Deno test, so the only way to "check" it was to read the nine-plus 409 arms of
 * `supabase/functions/ticket-checkout-create/index.ts` and hand-copy their
 * tokens into an assertion — i.e. to test a transcription of the server rather
 * than the server. This file has ZERO imports precisely so
 * `supabase/functions/ticket-checkout-create/__tests__/issue_2337_free_409_honest_copy.test.ts`
 * can drive the REAL edge handler to a REAL 409 and feed that REAL response
 * into the REAL mapper, in one process.
 *
 * WHAT WAS BROKEN. The mapper was:
 *
 *     if (httpStatusOf(error) === 409) return FREE_CHECKOUT_UNAVAILABLE_MESSAGE;
 *
 * 409 is the status `ticket-checkout-create` uses for EVERY state conflict on
 * the free rail — twelve reachable arms carrying five distinct bounded tokens.
 * The loudest of them, `free_reservation_already_exists`, means the guest
 * ALREADY HOLDS the reservation, and it was rendered as "this free ticket is no
 * longer available … nothing was reserved" — the exact opposite of the truth, on
 * an event whose ticket type is unlimited.
 *
 * THE RULE, inherited verbatim from #2188's paid-rail fix: MAP ON THE BOUNDED
 * TOKEN, NEVER ON THE STATUS ALONE. The status is transport; the token is
 * meaning. A 409 whose token we cannot read is a 409 we do not understand, and
 * an answer we do not understand must never be dressed up as "sold out".
 *
 * TWO PROPERTIES ARE LOAD-BEARING (the #2229 rules, restated for this rail):
 *
 *  1. TOTAL. `freeCheckoutErrorMessage` returns one of the constants below for
 *     EVERY input — every token, every status, `null`, `""`, a raw TypeError.
 *     It can never return its input, so a runtime string cannot reach a guest.
 *
 *  2. EVERY STRING SAYS WHAT HAPPENED TO THE RESERVATION. A guest must never be
 *     left unsure whether they hold a ticket. Do not add a constant here without
 *     deciding, explicitly, what it claims about the reservation — and when the
 *     honest answer is "we do not know", say that instead of guessing.
 */

// ---------------------------------------------------------------------------
// THE COPY
// ---------------------------------------------------------------------------

/**
 * issue #2136 [free-ticket checkout] — the sale itself is gone.
 *
 * Kept byte-identical through #2337. It is now reachable from exactly ONE
 * bounded token, `checkout_unavailable`, which is the only refusal that actually
 * means the sale stopped being sellable. That is the honest one.
 */
export const FREE_CHECKOUT_UNAVAILABLE_MESSAGE =
  "This free ticket is no longer available — the organizer may have paused or changed this event. Nothing was reserved.";

/**
 * issue #2136 — the reservation demonstrably did not happen and nothing was
 * created. Reachable only from refusals raised BEFORE any order can exist.
 */
export const FREE_CHECKOUT_FAILED_MESSAGE =
  "We could not reserve your free ticket. Nothing was reserved — please try again.";

/**
 * issue #2150 — the guest ALREADY holds this reservation.
 *
 * The copy must NOT say "nothing was reserved" — that is the exact opposite of
 * the truth here and would push a guest who already has a ticket into reserving
 * again somewhere else. It also must not imply failure: nothing went wrong, and
 * no duplicate was created.
 *
 * issue #2337 — before this change the constant existed but was UNREACHABLE.
 * `isFreeAlreadyReserved` narrows a 200 envelope with `kind:
 * "free_already_reserved"`, and `ticket-checkout-create` has never emitted one:
 * it answers HTTP 409 `free_reservation_already_exists`, which threw, which the
 * old status-keyed mapper turned into the "no longer available" sentence. The
 * copy was written in #2150 and shown to nobody.
 */
export const FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE =
  "You already have a free ticket for this event — we emailed your pass, and it is in your tickets. Nothing was reserved twice.";

/**
 * issue #2337 — genuinely out of tickets. THE ONLY STRING IN THIS MODULE THAT
 * CLAIMS THERE ARE NONE LEFT, and it is reachable only when the database itself
 * raised `ticket_capacity_exceeded`.
 *
 * That guard is `IF v_ticket_type.quantity_total IS NOT NULL AND v_sold +
 * v_reserved + v_cart_qty_for_type > v_ticket_type.quantity_total` (latest
 * definer: `20270420002160_issue_2160_multiday_multiselect.sql`), so an
 * UNLIMITED ticket type — `quantity_total IS NULL` — cannot reach it, and
 * therefore cannot reach this sentence. That is the whole point of #2337: the
 * sold-out claim now has to be EARNED by the server saying so.
 */
export const FREE_CHECKOUT_SOLD_OUT_MESSAGE =
  "There are no free tickets left for this event. Nothing was reserved.";

/**
 * issue #2337 — the honest answer for a conflict we cannot identify, and for
 * the finalize refusals where the reservation's state is genuinely unknown to
 * the client.
 *
 * It deliberately claims NEITHER direction. It does not say the sale is gone
 * (that would be the #2337 lie). It does not say "nothing was reserved" either:
 * `checkout_finalize_failed` with detail `tickets_missing` means an ORDER EXISTS
 * — telling that guest nothing was reserved would send them to reserve again.
 * "Check before you retry" is true under every one of these arms.
 */
export const FREE_CHECKOUT_CONFLICT_MESSAGE =
  "We could not complete this reservation right now. Check your email and your tickets before trying again — if a pass is already there, you are set.";

/**
 * issue #2337 — `intake_schema_stale`. Trip-shaped free reservations only: the
 * server arm that emits this token runs only when the event row's type column
 * marks the offering as a trip. The mapper is nevertheless shared with
 * `checkout-trip`, so the token is answered here rather than left to fall
 * through to a conflict sentence that says nothing useful.
 *
 * The condition above is described in prose deliberately. Quoting the
 * comparison verbatim trips ORCH-0963's C4 check
 * (`no-positive-event-type-trip-filter`), which matches RAW source including
 * comments — this file carries no such filter, and must not be allowlisted for
 * one it does not have.
 */
export const FREE_CHECKOUT_INTAKE_STALE_MESSAGE =
  "The organizer updated this event's questions, so the answers you gave are out of date. Reopen the tickets and answer them again — nothing was reserved.";

/**
 * issue #2511 item 6 — THE HONEST ANSWER WHEN WE DO NOT KNOW.
 *
 * This replaces FREE_CHECKOUT_FAILED_MESSAGE on the terminal arm. That arm is
 * reached by a network drop, a timeout, a 5xx, a CORS failure — anything with no
 * status and no token. In every one of those cases the request may well have
 * REACHED the server and created the reservation; the reply is simply lost.
 *
 * Saying "Nothing was reserved" there is a claim we cannot support, and it is
 * measurably harmful: three guests on We Go Again were told exactly that, changed
 * their email, submitted again, and ended up with TWO orders each (#2462). The
 * lie caused the duplicate.
 *
 * Nigerian mobile data and the Instagram in-app browser make lost replies common,
 * which is why this arm mattered so much more than its "last resort" position
 * suggests.
 */
export const FREE_CHECKOUT_UNKNOWN_MESSAGE =
  "We lost connection before we could confirm this. Your ticket may already be reserved \u2014 check your email before trying again, so you do not end up with two.";

/**
 * issue #2511 item 5 — ONE HONEST SENTENCE PER SERVER REFUSAL.
 *
 * The create-session RPC raises 20+ distinct bounded tokens. The edge function
 * puts every one of them in `detail` under a single `checkout_session_failed`
 * code, and before this change the mapper matched only `ticket_capacity_exceeded`
 * \u2014 so nineteen different, permanent, actionable refusals all rendered as
 * "Nothing was reserved \u2014 please try again", telling the guest to repeat an
 * action that could never succeed.
 *
 * VERIFIED, NOT ASSUMED: each token below was forced against the production RPC
 * and the raised MESSAGE_TEXT captured. They arrive as bare tokens
 * ("ticket_lines_required", "buyer_phone_required", "ticket_quantity_invalid",
 * "ticket_type_not_found", "event_not_found"), which is why substring matching on
 * `detail` is sound \u2014 the same mechanism the capacity arm has always used.
 *
 * EVERY SENTENCE OBEYS THE MODULE RULE: it says what happened to the reservation.
 * Each of these raises fires BEFORE any row is inserted, so "nothing was
 * reserved" is provably true for all of them \u2014 unlike the terminal arm above.
 */
const FREE_CHECKOUT_MESSAGE_BY_RAISE: Readonly<Record<string, string>> = Object
  .assign(Object.create(null) as Record<string, string>, {
    ticket_lines_required:
      "Your basket is empty. Pick at least one ticket, then try again \u2014 nothing was reserved.",
    ticket_quantity_invalid:
      "Choose at least one ticket before continuing \u2014 nothing was reserved.",
    buyer_phone_required:
      "That mobile number is not valid. Check the country code next to the field and the digits, then try again \u2014 nothing was reserved.",
    event_not_found:
      "This event is no longer available. Nothing was reserved.",
    event_not_selling:
      "This event is not selling tickets right now. Nothing was reserved.",
    // issue #2562 — the event already happened. Distinct from
    // `ticket_sales_ended` (the ORGANISER closed sales while the event is still
    // ahead) because the guest can act on that one by asking the organiser to
    // reopen, and cannot act on this one at all.
    event_already_ended:
      "This event has already taken place, so tickets are no longer available. Nothing was reserved.",
    occurrence_not_found:
      "The day you picked is no longer part of this event. Choose another day \u2014 nothing was reserved.",
    occurrence_not_available:
      "That day has already finished, so it can no longer be booked. Pick another day \u2014 nothing was reserved.",
    ticket_type_not_found:
      "That ticket no longer exists \u2014 the organiser may have removed it. Reload the page to see what is on sale. Nothing was reserved.",
    ticket_type_unavailable:
      "That ticket is not on sale. Reload the page to see what is available \u2014 nothing was reserved.",
    ticket_sales_not_started:
      "Sales for this ticket have not opened yet. Come back when they do \u2014 nothing was reserved.",
    ticket_sales_ended:
      "Sales have closed for this ticket. Nothing was reserved.",
    ticket_quantity_below_min:
      "This ticket has a minimum number per booking. Increase the quantity and try again \u2014 nothing was reserved.",
    ticket_quantity_above_max:
      "The organiser limits how many of this ticket one person can take. Lower the quantity and try again \u2014 nothing was reserved.",
    mixed_currency_cart:
      "These tickets are priced in different currencies and cannot be booked together. Book them separately \u2014 nothing was reserved.",
    event_currency_required:
      "This event is not set up to take payment yet. Nothing was reserved.",
    stripe_account_not_ready:
      "This organiser has not finished setting up payments, so paid tickets cannot be sold yet. Nothing was reserved.",
  });

/**
 * Every string this module can return, in one place, so a test can walk the
 * whole codomain instead of the arms someone remembered to list.
 */
export const FREE_CHECKOUT_MESSAGES: readonly string[] = [
  FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
  FREE_CHECKOUT_FAILED_MESSAGE,
  FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE,
  FREE_CHECKOUT_SOLD_OUT_MESSAGE,
  FREE_CHECKOUT_CONFLICT_MESSAGE,
  FREE_CHECKOUT_INTAKE_STALE_MESSAGE,
  // issue #2511
  FREE_CHECKOUT_UNKNOWN_MESSAGE,
  ...Object.values(FREE_CHECKOUT_MESSAGE_BY_RAISE),
];

// ---------------------------------------------------------------------------
// READING THE REFUSAL (#2188's shape, extended by one field)
// ---------------------------------------------------------------------------

/**
 * issue #2188 — what a handled edge refusal actually carries.
 *
 * `supabase.functions.invoke` reports every non-2xx as one opaque
 * `FunctionsHttpError` whose `.message` is the literal string "Edge Function
 * returned a non-2xx status code". The HTTP status lives on `.context` (a
 * `Response`) and the bounded token lives in that response's JSON body.
 *
 * issue #2337 adds `detail`. `ticket-checkout-create` returns
 * `{error:"checkout_session_failed", detail: sessionError.message}` when the
 * create-session RPC raises — and `ticket_capacity_exceeded` is raised by that
 * RPC, so the ONE genuinely-sold-out refusal on the free rail is invisible
 * unless the detail is carried. It is matched against a known constant and NEVER
 * rendered: the detail is a raw database message and is not guest-safe copy.
 */
export interface CheckoutRefusal {
  status: number | null;
  code: string | null;
  detail: string | null;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;

const stringField = (source: unknown, key: string): string | null => {
  const record = asRecord(source);
  if (record === null) return null;
  const raw = record[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
};

/**
 * The HTTP status of a refusal, when the transport exposed one. Retained for
 * the paid rail and for the LAST resort of the free mapper — never as the first
 * question asked. #2337 exists because it used to be the only question asked.
 */
export const httpStatusOf = (error: unknown): number | null => {
  const record = asRecord(error);
  if (record === null) return null;
  if (typeof record.status === "number") return record.status;
  const context = asRecord(record.context);
  if (context !== null && typeof context.status === "number") {
    return context.status;
  }
  return null;
};

/** The bounded `error` token `invokeOrThrow` carried onto the thrown error. */
export const codeOf = (error: unknown): string | null =>
  stringField(error, "code");

/** The bounded-ish `detail` field. Matched against constants, never rendered. */
export const detailOf = (error: unknown): string | null =>
  stringField(error, "detail");

const messageOf = (error: unknown): string => {
  if (typeof error === "string") return error;
  return stringField(error, "message") ?? "";
};

/**
 * issue #2188 — pull the status, the bounded token and the detail out of a
 * `FunctionsHttpError` before the body is gone.
 *
 * Moved here from `ticketCheckoutService.ts` by #2337 so the Deno suite can
 * exercise the EXACT function the client runs against a REAL `Response` built by
 * the real edge handler, rather than a hand-built lookalike.
 */
export const readEdgeRefusal = async (
  error: unknown,
): Promise<CheckoutRefusal> => {
  const record = asRecord(error);
  if (record === null) return { status: null, code: null, detail: null };
  const context = asRecord(record.context);
  if (context === null) return { status: null, code: null, detail: null };
  const rawStatus = context.status;
  const status = typeof rawStatus === "number" ? rawStatus : null;
  const json = context.json;
  if (typeof json !== "function") return { status, code: null, detail: null };
  try {
    const body: unknown = await (json as () => Promise<unknown>).call(context);
    return {
      status,
      code: stringField(body, "error"),
      detail: stringField(body, "detail"),
    };
  } catch {
    // A body that is already consumed / not JSON tells us nothing extra. The
    // status still stands, and the mapper below has a total fallback.
    return { status, code: null, detail: null };
  }
};

// ---------------------------------------------------------------------------
// THE MAPPER
// ---------------------------------------------------------------------------

/**
 * The bounded token `ticket-checkout-create` returns when the guest already
 * holds this free reservation and this request could not prove it is theirs.
 */
export const FREE_RESERVATION_ALREADY_EXISTS_TOKEN =
  "free_reservation_already_exists";

/** The exception `biz_ticket_checkout_create_session` raises when a LIMITED
 * ticket type is genuinely out of stock. */
export const TICKET_CAPACITY_EXCEEDED_TOKEN = "ticket_capacity_exceeded";

/**
 * Every bounded token the FREE rail of `ticket-checkout-create` can return,
 * mapped to the sentence that is true under it.
 *
 * PROTOTYPE-LESS ON PURPOSE (the #2264 P1-1 lesson). A plain object literal
 * carries `Object.prototype`, so a lookup keyed on an inherited member name
 * resolves to a Function or an object — never `undefined`, so `??` cannot catch
 * it — and a non-string reaches a `<Text>` child, where it renders NOTHING. A
 * guest on a failed reservation would be told nothing at all. Two mechanisms,
 * because they fail differently: no prototype to inherit from, AND an explicit
 * own-property guard at the point of use.
 */
const FREE_CHECKOUT_MESSAGE_BY_CODE: Readonly<Record<string, string>> = Object
  .assign(Object.create(null) as Record<string, string>, {
    // The guest holds it. The opposite of sold out. (index.ts:902)
    [FREE_RESERVATION_ALREADY_EXISTS_TOKEN]:
      FREE_CHECKOUT_ALREADY_RESERVED_MESSAGE,
    // The sale genuinely stopped being sellable. (index.ts:918/1054/1104/1120)
    checkout_unavailable: FREE_CHECKOUT_UNAVAILABLE_MESSAGE,
    // Refused before anything could be created. (index.ts:819/1008)
    checkout_session_failed: FREE_CHECKOUT_FAILED_MESSAGE,
    // The finalize refused AFTER it may have written state — `order_missing`
    // and `tickets_missing` both describe partial results, so this one must not
    // claim either direction. (index.ts:1079/1135/1146/1173)
    checkout_finalize_failed: FREE_CHECKOUT_CONFLICT_MESSAGE,
    // The organizer moved the intake schema under the answers. (index.ts:751)
    intake_schema_stale: FREE_CHECKOUT_INTAKE_STALE_MESSAGE,
  });

const lookup = (code: string | null): string | undefined =>
  code !== null &&
    Object.prototype.hasOwnProperty.call(FREE_CHECKOUT_MESSAGE_BY_CODE, code)
    ? FREE_CHECKOUT_MESSAGE_BY_CODE[code]
    : undefined;

/**
 * issue #2337 — does this refusal mean "you already hold this reservation"?
 *
 * Exported so `app/checkout/[eventId]/buyer.tsx` can ROUTE on it as well as
 * render copy: the guest is told they already have the ticket, and is taken to
 * it whenever this app session can prove possession. This is a predicate over
 * the same bounded token the mapper reads — deliberately NOT a second mapper.
 */
export const isFreeReservationAlreadyExists = (error: unknown): boolean =>
  codeOf(error) === FREE_RESERVATION_ALREADY_EXISTS_TOKEN ||
  messageOf(error).includes(FREE_RESERVATION_ALREADY_EXISTS_TOKEN);

/**
 * Map ANY free-checkout failure to guest-readable copy. Pure and total.
 *
 * ORDER IS THE CONTRACT:
 *   1. the bounded token, always first — this is #2337's entire fix;
 *   2. the capacity exception hidden in `detail`, which is the ONLY route to a
 *      sold-out sentence;
 *   3. copy this module already owns, passed through unchanged (`buyer.tsx`
 *      throws `FREE_CHECKOUT_FAILED_MESSAGE` at itself when it refuses an
 *      envelope);
 *   4. a bounded token embedded in `.message`, for callers that never went
 *      through `invokeOrThrow` (the #2136 shape);
 *   5. a 409 we could not identify — NOT sold out, NOT "nothing was reserved";
 *   6. everything else.
 */
/**
 * issue #2511 — find the RPC raise token inside a raw database message.
 *
 * Longest-first so a token that is a prefix of another cannot shadow it. The
 * message arrives as the bare token today, but substring matching is kept
 * because that is what the capacity arm has always relied on and a future
 * Postgres/PostgREST version may add a prefix.
 */
const RAISE_TOKENS_LONGEST_FIRST = Object
  .keys(FREE_CHECKOUT_MESSAGE_BY_RAISE)
  .sort((a, b) => b.length - a.length);

const raiseMessageIn = (haystack: string): string | undefined => {
  if (haystack.length === 0) return undefined;
  for (const token of RAISE_TOKENS_LONGEST_FIRST) {
    if (haystack.includes(token)) return FREE_CHECKOUT_MESSAGE_BY_RAISE[token];
  }
  return undefined;
};

export const freeCheckoutErrorMessage = (error: unknown): string => {
  const code = codeOf(error);
  const detail = detailOf(error) ?? "";

  // (2) before (1): a create-session refusal carries `checkout_session_failed`
  // for every RPC raise, and only the detail distinguishes a genuinely sold-out
  // sale from a plumbing failure. Both are honest; this one is more useful.
  if (detail.includes(TICKET_CAPACITY_EXCEEDED_TOKEN)) {
    return FREE_CHECKOUT_SOLD_OUT_MESSAGE;
  }

  // issue #2511 item 5 — the OTHER nineteen refusals hiding in the same detail.
  // Before this, every one of them rendered as "Nothing was reserved - please
  // try again", which sent guests to repeat an action that could never work:
  // sales closed, a per-person limit, a removed ticket type. Each now says what
  // happened and what to change. Checked after capacity so the sold-out
  // sentence keeps its precedence.
  const byRaiseDetail = raiseMessageIn(detail);
  if (byRaiseDetail !== undefined) return byRaiseDetail;

  const byToken = lookup(code);
  if (byToken !== undefined) return byToken;

  const message = messageOf(error);
  if (FREE_CHECKOUT_MESSAGES.includes(message)) return message;

  if (message.includes(TICKET_CAPACITY_EXCEEDED_TOKEN)) {
    return FREE_CHECKOUT_SOLD_OUT_MESSAGE;
  }
  for (const token of Object.keys(FREE_CHECKOUT_MESSAGE_BY_CODE)) {
    if (message.includes(token)) return FREE_CHECKOUT_MESSAGE_BY_CODE[token];
  }
  // issue #2511 — same raise tokens, for a caller that never went through
  // `invokeOrThrow` and so has no `detail` to read.
  const byRaiseMessage = raiseMessageIn(message);
  if (byRaiseMessage !== undefined) return byRaiseMessage;

  // #2337 — the arm the whole issue is about. An unidentified 409 still means
  // "the server refused because of the state of this sale", which is a real
  // fact; "there are no tickets left" is not, and inventing it is what told a
  // guest an unlimited event was full.
  if (httpStatusOf(error) === 409) return FREE_CHECKOUT_CONFLICT_MESSAGE;

  // issue #2511 item 6 — THE ARM THAT USED TO LIE.
  //
  // No status, no token, no recognised message: a dropped connection, a
  // timeout, a 5xx, a CORS failure. The request may have reached the server and
  // created the reservation; only the REPLY is missing. Claiming "Nothing was
  // reserved" here is unprovable, and it demonstrably caused harm - three
  // guests were told it, changed their email, resubmitted and ended up holding
  // two orders each (#2462).
  //
  // FREE_CHECKOUT_FAILED_MESSAGE keeps its "nothing was reserved" wording and
  // stays reachable ONLY from refusals raised before any row can exist. It is
  // no longer the catch-all.
  return FREE_CHECKOUT_UNKNOWN_MESSAGE;
};
