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
 * issue #2337 — `intake_schema_stale`. Trip-shaped free reservations only (the
 * arm is gated on `event_type === 'trip'`), but the mapper is shared with
 * `checkout-trip`, so the token is answered here rather than left to fall
 * through to a conflict sentence that says nothing useful.
 */
export const FREE_CHECKOUT_INTAKE_STALE_MESSAGE =
  "The organizer updated this event's questions, so the answers you gave are out of date. Reopen the tickets and answer them again — nothing was reserved.";

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
export const freeCheckoutErrorMessage = (error: unknown): string => {
  const code = codeOf(error);

  // (2) before (1): a create-session refusal carries `checkout_session_failed`
  // for every RPC raise, and only the detail distinguishes a genuinely sold-out
  // sale from a plumbing failure. Both are honest; this one is more useful.
  if ((detailOf(error) ?? "").includes(TICKET_CAPACITY_EXCEEDED_TOKEN)) {
    return FREE_CHECKOUT_SOLD_OUT_MESSAGE;
  }

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

  // #2337 — the arm the whole issue is about. An unidentified 409 still means
  // "the server refused because of the state of this sale", which is a real
  // fact; "there are no tickets left" is not, and inventing it is what told a
  // guest an unlimited event was full.
  if (httpStatusOf(error) === 409) return FREE_CHECKOUT_CONFLICT_MESSAGE;

  return FREE_CHECKOUT_FAILED_MESSAGE;
};
