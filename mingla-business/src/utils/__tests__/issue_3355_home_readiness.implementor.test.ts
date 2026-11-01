/**
 * #3355 P5 — Home consumes the canonical brand readiness read.
 *
 * Fixtures are REAL `brand_readiness_internal` answers captured from the local
 * stacks (Sites Core 56321 "Local Test Trips" for owner / event manager /
 * scanner, two thin brands, the Harmattan Club demo brand, the same brand on
 * the Paystack hold rail, and the same brand with a brand-wide "Not now" on
 * its phone), trimmed of the catalogue's ask/verify copy and value previews.
 *
 * Happy path (SPEC 7.1 P5): Home's brand/profile rows are exactly the
 * readiness items Home maps, in the server's states (SC-6).
 * Seth's scope change (2026-11-01): Home is the reminder list — Ari's
 * brand-wide "not now" never hides, dims, relabels or reorders a Home row.
 * Adversarial (SPEC 7.1 P5): a scanner sees no profile or money rows; an
 * event manager sees "Ask …" rows that do nothing on tap.
 */
import { describe, expect, test } from "@jest/globals";

import fixtures from "./__fixtures__/brandReadiness.issue3355.json";
import {
  BrandReadinessShapeError,
  isBrandReadinessItemDone,
  parseBrandReadiness,
  type BrandReadiness,
} from "../../services/brandReadinessService";
import {
  buildBusinessTodos,
  HOME_MONEY_READINESS_KEYS,
  HOME_READINESS_ROWS,
  type BusinessTodo,
  type BusinessTodoInput,
} from "../businessTodos";
import { toHomeBrandReadiness } from "../homeBrandReadiness";
import type { BrandRole } from "../brandRole";
import { dispatchBusinessTodoAction } from "../businessTodoDispatch";

type FixtureName = keyof typeof fixtures;

const load = (name: FixtureName): BrandReadiness =>
  parseBrandReadiness(fixtures[name] as unknown);

const base: BusinessTodoInput = {
  hasNoBrands: false,
  hasBrandsButNoSelection: false,
  brandResolving: false,
  hasBrand: true,
  pipelineFetched: true,
  pipelineStatus: null,
  pipelineRoute: "",
  venuePipelines: [],
  venueClaims: [],
  venueDrafts: [],
  venueDraftInProgress: false,
  counts: { total: 2, live: 1, draft: 0 },
  stripeActive: true,
  hasDraftPaidOffering: false,
  stripeRoute: "/brand/b/payments",
  draftRoute: null,
  venueClaimPending: false,
  venueListingRoute: "/brand/b/listing",
  venueClaimOpenFeedbackCount: 0,
  venueFeedbackRoute: "/brand/b/listing?focus=feedback",
};

/** Exactly what useBusinessTodos does with the server answer. */
const homeTodos = (
  readiness: BrandReadiness,
  role: BrandRole | null = "brand_owner",
): BusinessTodo[] =>
  buildBusinessTodos({
    ...base,
    stripeRoute: `/brand/${readiness.brandId}/payments`,
    stripeActive: readiness.money.canSell,
    payoutReady: readiness.money.canBePaidOut,
    brandReadiness: toHomeBrandReadiness({
      brandId: readiness.brandId,
      readiness,
      readinessFailed: false,
      role,
      roleLoading: false,
    }),
  });

const HOME_KEY_BY_ID = new Map<string, string>(
  HOME_READINESS_ROWS.map((row) => [row.id, row.key]),
);

const SNAPSHOT_BRANDS: FixtureName[] = [
  "local_test_trips_owner",
  "gogi_fixture_owner",
  "young_and_stamped_owner",
  "harmattan_club_owner",
];

describe("#3355 P5 — Home rows ARE the canonical readiness items (SC-6)", () => {
  test.each(SNAPSHOT_BRANDS)("%s: profile rows = unmet mapped items, same states", (name) => {
    const readiness = load(name);
    const todos = homeTodos(readiness);
    const homeKeys = todos
      .map((todo) => HOME_KEY_BY_ID.get(todo.id))
      .filter((key): key is string => key !== undefined);
    const mapped = new Set<string>(HOME_READINESS_ROWS.map((row) => row.key));
    const expected = readiness.items
      .filter((item) => mapped.has(item.key) && !isBrandReadinessItemDone(item))
      .map((item) => item.key);
    expect(new Set(homeKeys)).toEqual(new Set(expected));
    // Every row carries the server item it came from (Not now / Undo target).
    for (const todo of todos.filter((t) => HOME_KEY_BY_ID.has(t.id))) {
      expect(todo.readinessKey).toBe(HOME_KEY_BY_ID.get(todo.id));
    }
  });

  test.each(SNAPSHOT_BRANDS)("%s: money rows follow the server's can_sell / can_be_paid_out", (name) => {
    const readiness = load(name);
    const ids = homeTodos(readiness).map((t) => t.id);
    expect(ids.includes("connect_stripe")).toBe(!readiness.money.canSell);
    if (readiness.money.canSell) {
      expect(ids.includes("add_bank_to_get_paid")).toBe(!readiness.money.canBePaidOut);
    }
  });

  test("C4 tagline: a one-paragraph description is 'missing tagline' on Home AND on the server", () => {
    const readiness = load("local_test_trips_owner");
    const tagline = readiness.items.find((i) => i.key === "tagline");
    expect(tagline?.state).toBe("missing");
    expect(homeTodos(readiness).map((t) => t.id)).toContain("profile_add_tagline");
  });

  test("an owner exception (not_applicable address) shows no address row", () => {
    const readiness = load("local_test_trips_owner");
    expect(readiness.items.find((i) => i.key === "address")?.state).toBe("not_applicable");
    expect(homeTodos(readiness).map((t) => t.id)).not.toContain("profile_add_address");
  });

  test("timezone is a readiness item but never a Home row (no Host control yet)", () => {
    const readiness = load("gogi_fixture_owner");
    expect(readiness.items.find((i) => i.key === "timezone")?.state).toBe("missing");
    expect(HOME_READINESS_ROWS.some((row) => (row.key as string) === "timezone")).toBe(false);
  });
});

describe("#3355 P5 — Home ignores Ari's 'not now' (Seth 2026-11-01 scope change)", () => {
  test("a brand-wide deferral changes nothing on Home: same rows, same order, same copy", () => {
    const skipped = load("harmattan_phone_skipped_owner");
    const plain = load("harmattan_club_owner");
    expect(skipped.items.find((i) => i.key === "contact_phone")).toBeDefined();
    expect(
      (fixtures.harmattan_phone_skipped_owner as { items: { key: string; deferral: unknown }[] })
        .items.find((i) => i.key === "contact_phone")?.deferral,
    ).not.toBeNull();
    const strip = (todos: BusinessTodo[]) =>
      todos.map((t) => [t.id, t.label, t.sublabel, t.action]);
    expect(strip(homeTodos(skipped))).toEqual(strip(homeTodos(plain)));
    const phone = homeTodos(skipped).find((t) => t.id === "profile_add_phone");
    expect(phone?.sublabel).toBe("Another way to reach you");
  });

  test("the can-sell row routes the owner to payments", () => {
    const connect = homeTodos(load("local_test_trips_owner")).find((t) => t.id === "connect_stripe");
    expect(connect?.readinessKey).toBe(HOME_MONEY_READINESS_KEYS.canSell);
    expect(connect?.action).toEqual({
      kind: "route",
      route: "/brand/49dc7651-b14c-4905-a42e-2e2957abc171/payments",
    });
  });
});

describe("#3355 P5 — roles (C9), adversarial", () => {
  test("scanner: no profile rows and no money rows at all", () => {
    const todos = homeTodos(load("local_test_trips_scanner"), "scanner");
    expect(todos.some((t) => HOME_KEY_BY_ID.has(t.id))).toBe(false);
    expect(todos.some((t) => t.id === "connect_stripe" || t.id === "add_bank_to_get_paid")).toBe(false);
  });

  test("event manager: rows name who can fix them and are text-only", () => {
    const todos = homeTodos(load("local_test_trips_event_manager"), "event_manager");
    const tagline = todos.find((t) => t.id === "profile_add_tagline");
    expect(tagline?.action).toEqual({ kind: "info" });
    expect(tagline?.sublabel).toBe("Ask a brand admin or the owner to do this");
    const connect = todos.find((t) => t.id === "connect_stripe");
    expect(connect?.action).toEqual({ kind: "info" });
    expect(connect?.sublabel).toBe("Ask the brand owner to do this");
  });

  test("an info row dispatches nothing (no dead navigation)", () => {
    const calls: string[] = [];
    dispatchBusinessTodoAction(
      { id: "x", label: "x", action: { kind: "info" } },
      {
        openBrandSwitcher: () => calls.push("switcher"),
        openUniversalCreator: () => calls.push("creator"),
        route: (r) => calls.push(r),
        openPendingInvite: () => calls.push("invite"),
      },
    );
    expect(calls).toEqual([]);
  });

  test("while the role is still loading nothing brand-level renders (no scanner flash)", () => {
    const readiness = load("local_test_trips_scanner");
    const todos = buildBusinessTodos({
      ...base,
      stripeActive: false,
      brandReadiness: toHomeBrandReadiness({
        brandId: readiness.brandId,
        readiness,
        readinessFailed: false,
        role: null,
        roleLoading: true,
      }),
    });
    expect(todos.some((t) => HOME_KEY_BY_ID.has(t.id) || t.id === "connect_stripe")).toBe(false);
  });
});

describe("#3355 P5 — loading and failure are honest", () => {
  test("loading: no profile and no money rows (a row must be a true statement)", () => {
    const todos = buildBusinessTodos({
      ...base,
      stripeActive: false,
      brandReadiness: { status: "loading" },
    });
    expect(todos.map((t) => t.id)).toEqual([]);
  });

  test("error: one 'couldn't check' row with Try again, no guessed rows", () => {
    const todos = buildBusinessTodos({
      ...base,
      stripeActive: false,
      brandReadiness: { status: "error", brandId: "b-err" },
    });
    expect(todos.map((t) => t.id)).toEqual(["brand_readiness_error"]);
    expect(todos[0]?.retryReadinessBrandId).toBe("b-err");
    expect(todos[0]?.action).toEqual({ kind: "info" });
  });

  test("a readiness answer for a different brand never paints this brand's rows", () => {
    const readiness = load("harmattan_club_owner");
    expect(
      toHomeBrandReadiness({
        brandId: "another-brand",
        readiness,
        readinessFailed: false,
        role: "brand_owner",
        roleLoading: false,
      }),
    ).toEqual({ status: "loading" });
  });

  test("the parser refuses shape drift instead of guessing", () => {
    const raw = JSON.parse(JSON.stringify(fixtures.harmattan_club_owner)) as {
      items: { state: string }[];
    };
    raw.items[0]!.state = "done-ish";
    expect(() => parseBrandReadiness(raw)).toThrow(BrandReadinessShapeError);
    expect(() => parseBrandReadiness({ items: [] })).toThrow(BrandReadinessShapeError);
  });
});
