/**
 * #4226 — admin email audiences read the People list (admin_people_directory):
 * Explorer / Host mean what they mean on People, ticket buyers with no account
 * can be reached, staff/test are left out of bulk sends, and marketing to
 * ticket buyers needs consent. The fake query below applies the same
 * PostgREST filters the edge function sends to an in-memory people list.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  applyDirectoryFilters,
  arrayLiteral,
  type DirectoryRow,
  directoryRowToRecipient,
  requiresMarketingConsent,
} from "./audience.ts";
import {
  type AudienceDefinition,
  fallbackPersonalization,
  normalizeAudience,
  snapshotAudience,
} from "./model.ts";

type Row = DirectoryRow & {
  brand_ids?: string[];
  has_completed_onboarding?: boolean | null;
  active?: boolean | null;
};

const BRAND_WGA = "11111111-1111-4111-8111-111111111111";
const BRAND_CTRL = "22222222-2222-4222-8222-222222222222";

const PEOPLE: Row[] = [
  {
    person_key: "u:explorer",
    user_id: "00000000-0000-4000-8000-000000000001",
    email: "explorer@mingla-fixture.org",
    name: "Ex Plorer",
    app_status: "explorer",
    segment: "explorer",
    is_internal: false,
    is_ticket_holder: false,
    marketing_consent: "no",
    event_cities: [],
    brand_ids: [],
    country: "US",
  },
  {
    person_key: "u:both",
    user_id: "00000000-0000-4000-8000-000000000002",
    email: "both@mingla-fixture.org",
    name: "Bo Th",
    app_status: "both",
    segment: "both",
    is_internal: false,
    is_ticket_holder: true,
    marketing_consent: "yes",
    event_cities: ["Lagos"],
    brand_ids: [BRAND_CTRL],
    country: "NG",
  },
  {
    person_key: "u:host",
    user_id: "00000000-0000-4000-8000-000000000003",
    email: "host@mingla-fixture.org",
    name: "Ho St",
    app_status: "host",
    segment: "host",
    is_internal: false,
    is_ticket_holder: false,
    marketing_consent: "no",
    event_cities: [],
    brand_ids: [],
    country: "NG",
  },
  {
    // The old Email tab called this person an "Explorer user" (bug).
    person_key: "u:incomplete",
    user_id: "00000000-0000-4000-8000-000000000004",
    email: "incomplete@mingla-fixture.org",
    name: "In Complete",
    app_status: "incomplete",
    segment: "incomplete",
    is_internal: false,
    is_ticket_holder: true,
    marketing_consent: "yes",
    event_cities: ["Lagos"],
    brand_ids: [BRAND_WGA],
    country: "NG",
  },
  {
    // Staff with the Explorer app: never in a bulk send.
    person_key: "u:staff",
    user_id: "00000000-0000-4000-8000-000000000005",
    email: "staff@usemingla.com",
    name: "Sta Ff",
    app_status: "explorer",
    segment: "internal",
    is_internal: true,
    is_ticket_holder: true,
    marketing_consent: "yes",
    event_cities: ["Lagos"],
    brand_ids: [BRAND_WGA],
    country: "US",
  },
  {
    person_key: "e:ada@mingla-fixture.org",
    user_id: null,
    email: "ada@mingla-fixture.org",
    name: "Ada Buyer",
    app_status: "ticket_buyer_no_app",
    segment: "ticket_buyer_no_app",
    is_internal: false,
    is_ticket_holder: true,
    marketing_consent: "yes",
    event_cities: ["Lagos"],
    brand_ids: [BRAND_WGA],
    country: "NG",
  },
  {
    person_key: "e:obi@mingla-fixture.org",
    user_id: null,
    email: "obi@mingla-fixture.org",
    name: "Obi NoConsent",
    app_status: "ticket_buyer_no_app",
    segment: "ticket_buyer_no_app",
    is_internal: false,
    is_ticket_holder: true,
    marketing_consent: "no",
    event_cities: ["Lagos"],
    brand_ids: [BRAND_WGA],
    country: "NG",
  },
  {
    person_key: "e:uche@mingla-fixture.org",
    user_id: null,
    email: "uche@mingla-fixture.org",
    name: "Uche Unsub",
    app_status: "ticket_buyer_no_app",
    segment: "ticket_buyer_no_app",
    is_internal: false,
    is_ticket_holder: true,
    marketing_consent: "unsubscribed",
    event_cities: ["Lagos"],
    brand_ids: [BRAND_CTRL],
    country: "NG",
  },
  {
    person_key: "e:test.buyer@mingla-fixture.org",
    user_id: null,
    email: "test.buyer@mingla-fixture.org",
    name: "Test Buyer",
    app_status: "ticket_buyer_no_app",
    segment: "internal",
    is_internal: true,
    is_ticket_holder: true,
    marketing_consent: "yes",
    event_cities: ["Lagos"],
    brand_ids: [BRAND_WGA],
    country: "NG",
  },
  {
    person_key: "e:raleigh@mingla-fixture.org",
    user_id: null,
    email: "raleigh@mingla-fixture.org",
    name: "Ray Leigh",
    app_status: "ticket_buyer_no_app",
    segment: "ticket_buyer_no_app",
    is_internal: false,
    is_ticket_holder: true,
    marketing_consent: "yes",
    event_cities: ["Raleigh"],
    brand_ids: [BRAND_CTRL],
    country: "US",
  },
];

function parseArrayLiteral(value: string): string[] {
  const inner = value.replace(/^\{/, "").replace(/\}$/, "");
  return [...inner.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) =>
    m[1].replace(/\\(.)/g, "$1")
  );
}

/** A PostgREST-shaped builder that filters the in-memory list. */
class FakeQuery {
  constructor(public rows: Row[], public calls: string[] = []) {}
  private next(pred: (row: Row) => boolean, call: string) {
    return new FakeQuery(this.rows.filter(pred), [...this.calls, call]);
  }
  eq(column: string, value: unknown) {
    return this.next(
      (row) => (row as Record<string, unknown>)[column] === value,
      `eq:${column}:${value}`,
    );
  }
  in(column: string, values: unknown[]) {
    return this.next(
      (row) => values.includes((row as Record<string, unknown>)[column]),
      `in:${column}:${values.join("|")}`,
    );
  }
  contains(column: string, literal: string) {
    const wanted = parseArrayLiteral(literal);
    return this.next((row) => {
      const have = ((row as Record<string, unknown>)[column] ?? []) as string[];
      return wanted.every((value) => have.includes(value));
    }, `cs:${column}:${literal}`);
  }
  gte(column: string, value: string) {
    return this.next(
      (row) => String((row as Record<string, unknown>)[column] ?? "") >= value,
      `gte:${column}`,
    );
  }
  lte(column: string, value: string) {
    return this.next(
      (row) => String((row as Record<string, unknown>)[column] ?? "") <= value,
      `lte:${column}`,
    );
  }
}

function audienceOf(audience: AudienceDefinition): Row[] {
  return (applyDirectoryFilters(new FakeQuery(PEOPLE), audience) as FakeQuery)
    .rows;
}

function keys(rows: Row[]): string[] {
  return rows.map((row) => String(row.person_key)).sort();
}

function snapshotOf(raw: unknown) {
  const audience = normalizeAudience(raw);
  const recipients = audienceOf(audience).map(directoryRowToRecipient);
  return snapshotAudience(recipients, new Set(), {
    excludeInternal: audience.mode !== "person",
    requireConsent: (profile) => requiresMarketingConsent(audience, profile),
  });
}

Deno.test("#4226 Explorer audience uses the People classifier: no incomplete sign-ups, staff left out", () => {
  const audience = normalizeAudience({
    mode: "segment",
    filters: { userType: "explorer" },
  });
  assertEquals(keys(audienceOf(audience)), [
    "u:both",
    "u:explorer",
    "u:staff",
  ]);
  const snapshot = snapshotOf({
    mode: "segment",
    filters: { userType: "explorer" },
  });
  assertEquals(
    snapshot.deliveries.map((d) => d.recipient_email).sort(),
    ["both@mingla-fixture.org", "explorer@mingla-fixture.org"],
  );
  assertEquals(snapshot.internalExcluded, 1);
  // Explorer accounts are not held to the ticket-buyer consent rule.
  assertEquals(snapshot.noConsent, 0);
  assertEquals(snapshot.willReceive, 2);
});

Deno.test("#4226 Host audience is host or both; Everyone is people with an app", () => {
  assertEquals(
    keys(audienceOf(normalizeAudience({
      mode: "segment",
      filters: { userType: "host" },
    }))),
    ["u:both", "u:host"],
  );
  assertEquals(
    keys(audienceOf(normalizeAudience({ mode: "everyone" }))),
    ["u:both", "u:explorer", "u:host", "u:staff"],
  );
});

Deno.test("#4226 Ticket buyers audience reaches no-account buyers with consent and counts who is left out", () => {
  const snapshot = snapshotOf({
    mode: "segment",
    filters: { userType: "ticket_buyers" },
  });
  // Ticket holders: both, incomplete, staff, ada, obi, uche, test, raleigh.
  assertEquals(snapshot.matched, 8);
  assertEquals(snapshot.internalExcluded, 2, "staff account and test email");
  assertEquals(snapshot.noConsent, 1, "Obi never agreed to marketing");
  assertEquals(snapshot.skippedOptOut, 1, "Uche unsubscribed");
  assertEquals(
    snapshot.deliveries.filter((d) => d.status === "pending").map((d) =>
      d.recipient_email
    ).sort(),
    [
      "ada@mingla-fixture.org",
      "both@mingla-fixture.org",
      "incomplete@mingla-fixture.org",
      "raleigh@mingla-fixture.org",
    ],
  );
  assertEquals(snapshot.willReceive, 4);
  const ada = snapshot.deliveries.find((d) =>
    d.recipient_email === "ada@mingla-fixture.org"
  );
  assertEquals(ada?.profile_id, null, "no account: no profile id");
  assertEquals(
    fallbackPersonalization(ada!.personalization).first_name,
    "Ada",
    "{first_name} comes from the checkout name",
  );
});

Deno.test("#4226 Ticket buyers, no app, Lagos matches the People tab rule", () => {
  const snapshot = snapshotOf({
    mode: "segment",
    filters: {
      userType: "ticket_buyers",
      appStatus: "ticket_buyer_no_app",
      city: "Lagos",
    },
  });
  // ada, obi, uche, test (internal) — Raleigh is out by city.
  assertEquals(snapshot.matched, 4);
  assertEquals(snapshot.internalExcluded, 1);
  assertEquals(
    snapshot.deliveries.filter((d) => d.status === "pending").map((d) =>
      d.recipient_email
    ),
    ["ada@mingla-fixture.org"],
  );
});

Deno.test("#4226 segment filters: bought tickets, brand bought from, country", () => {
  assertEquals(
    keys(audienceOf(normalizeAudience({
      mode: "segment",
      filters: { userType: "all", boughtTickets: "no" },
    }))),
    ["u:explorer", "u:host"],
  );
  assertEquals(
    keys(audienceOf(normalizeAudience({
      mode: "segment",
      filters: { userType: "ticket_buyers", brandId: BRAND_CTRL },
    }))),
    ["e:raleigh@mingla-fixture.org", "e:uche@mingla-fixture.org", "u:both"],
  );
  assertEquals(
    keys(audienceOf(normalizeAudience({
      mode: "segment",
      filters: { userType: "ticket_buyers", country: "US" },
    }))),
    ["e:raleigh@mingla-fixture.org", "u:staff"],
  );
  assertEquals(
    keys(audienceOf(normalizeAudience({
      mode: "segment",
      filters: { appStatus: "incomplete" },
    }))),
    ["u:incomplete"],
    "an app-status filter alone picks exactly that status",
  );
});

Deno.test("#4226 one person: a no-account buyer by email, consent still required", () => {
  const ok = snapshotOf({ mode: "person", email: "ADA@mingla-fixture.org" });
  assertEquals(ok.willReceive, 1);
  const refused = snapshotOf({
    mode: "person",
    email: "obi@mingla-fixture.org",
  });
  assertEquals(refused.willReceive, 0);
  assertEquals(refused.noConsent, 1);
  const outsider = snapshotOf({
    mode: "person",
    email: "stranger@mingla-fixture.org",
  });
  assertEquals(outsider.matched, 0, "only people on the admin list");
});

Deno.test("#4226 city and brand filters are quoted array literals", () => {
  assertEquals(arrayLiteral("Lagos"), '{"Lagos"}');
  assertEquals(arrayLiteral('New "York", NY'), '{"New \\"York\\", NY"}');
  assertEquals(parseArrayLiteral(arrayLiteral('New "York", NY')), [
    'New "York", NY',
  ]);
});

Deno.test("#4226 the edge function reads the People list, not the old segment view", () => {
  const src = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  assertEquals(src.includes("profiles_with_segment"), false);
  assertEquals(src.includes("derive_user_segment"), false);
  assertStringIncludes(src, '.rpc("admin_people_directory")');
  assertStringIncludes(src, "no_consent_count: snapshot.noConsent");
  assertStringIncludes(
    src,
    "internal_excluded_count: snapshot.internalExcluded",
  );
  assertStringIncludes(src, "no_consent: snapshot.noConsent");
  // Unsubscribe stays keyed by email, so it works with no account.
  assertStringIncludes(src, "recipient_email: recipientEmail.toLowerCase()");
});
