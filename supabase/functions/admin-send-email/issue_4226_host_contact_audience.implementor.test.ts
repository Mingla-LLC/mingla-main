/**
 * #4226 — host contacts are emailable (Seth, 2026-11-02), and Everyone means
 * everyone on the People list. The fake query applies the same PostgREST
 * filters the edge function sends to an in-memory copy of
 * admin_people_directory(), one person per group plus the people the rules
 * leave out.
 */
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  applyDirectoryFilters,
  appStatusLabel,
  DIRECTORY_COLUMNS,
  type DirectoryRow,
  directoryRowToRecipient,
  EVERYONE_GROUPS,
  requiresMarketingConsent,
} from "./audience.ts";
import { normalizeAudience, snapshotAudience } from "./model.ts";

type Row = DirectoryRow & { brand_ids?: string[] };

const LANTERN = "33333333-3333-4333-8333-333333333333";

const base = {
  is_internal: false,
  is_ticket_holder: false,
  is_host_contact: false,
  marketing_consent: "no",
  event_cities: [],
  brand_ids: [],
  host_brand_ids: [],
};

const PEOPLE: Row[] = [
  {
    ...base,
    person_key: "u:explorer",
    user_id: "00000000-0000-4000-8000-000000000001",
    email: "explorer@mingla-fixture.org",
    app_status: "explorer",
    segment: "explorer",
  },
  {
    ...base,
    person_key: "u:host",
    user_id: "00000000-0000-4000-8000-000000000002",
    email: "host@mingla-fixture.org",
    app_status: "host",
    segment: "host",
  },
  {
    ...base,
    person_key: "u:both",
    user_id: "00000000-0000-4000-8000-000000000003",
    email: "both@mingla-fixture.org",
    app_status: "both",
    segment: "both",
    // An app user a host also imported.
    is_host_contact: true,
    host_brand_ids: [LANTERN],
    marketing_consent: "yes",
    consent_basis: "host_import_attestation",
  },
  {
    ...base,
    person_key: "u:incomplete",
    user_id: "00000000-0000-4000-8000-000000000004",
    email: "incomplete@mingla-fixture.org",
    app_status: "incomplete",
    segment: "incomplete",
  },
  {
    ...base,
    person_key: "e:ada@mingla-fixture.org",
    user_id: null,
    email: "ada@mingla-fixture.org",
    name: "Ada Buyer",
    app_status: "ticket_buyer_no_app",
    segment: "ticket_buyer_no_app",
    is_ticket_holder: true,
    in_ticket_buyer_segment: true,
    marketing_consent: "yes",
    consent_basis: "checkout",
  },
  {
    ...base,
    person_key: "e:kemi@mingla-fixture.org",
    user_id: null,
    email: "kemi@mingla-fixture.org",
    name: "Kemi Imported",
    app_status: "host_contact_no_app",
    segment: "host_contact_no_app",
    is_host_contact: true,
    host_brand_ids: [LANTERN],
    host_city: "Lagos",
    country: "NG",
    marketing_consent: "yes",
    consent_basis: "host_import_attestation",
  },
  {
    // Suppressed by the brand that added them: the list says 'unsubscribed'.
    ...base,
    person_key: "e:sam@mingla-fixture.org",
    user_id: null,
    email: "sam@mingla-fixture.org",
    app_status: "host_contact_no_app",
    segment: "host_contact_no_app",
    is_host_contact: true,
    host_brand_ids: [LANTERN],
    marketing_consent: "unsubscribed",
  },
  {
    // A host contact who said no at checkout (also a ticket buyer).
    ...base,
    person_key: "e:bola@mingla-fixture.org",
    user_id: null,
    email: "bola@mingla-fixture.org",
    app_status: "ticket_buyer_no_app",
    segment: "ticket_buyer_no_app",
    is_ticket_holder: true,
    in_ticket_buyer_segment: true,
    is_host_contact: true,
    host_brand_ids: [LANTERN],
    marketing_consent: "no",
  },
  {
    ...base,
    person_key: "e:test.contact@mingla-fixture.org",
    user_id: null,
    email: "test.contact@mingla-fixture.org",
    app_status: "host_contact_no_app",
    segment: "internal",
    is_internal: true,
    is_host_contact: true,
    marketing_consent: "yes",
  },
  {
    ...base,
    person_key: "e:noemail",
    user_id: null,
    email: "not-an-email",
    app_status: "host_contact_no_app",
    segment: "host_contact_no_app",
    is_host_contact: true,
    marketing_consent: "yes",
  },
];

class FakeQuery {
  constructor(public rows: Row[]) {}
  private next(pred: (row: Row) => boolean) {
    return new FakeQuery(this.rows.filter(pred));
  }
  eq(column: string, value: unknown) {
    return this.next((row) =>
      (row as Record<string, unknown>)[column] === value
    );
  }
  in(column: string, values: unknown[]) {
    return this.next((row) =>
      values.includes((row as Record<string, unknown>)[column])
    );
  }
  contains(column: string, literal: string) {
    const wanted = literal.replace(/^\{"|"\}$/g, "");
    return this.next((row) =>
      (((row as Record<string, unknown>)[column] ?? []) as string[]).includes(
        wanted,
      )
    );
  }
}

function snapshotOf(raw: unknown) {
  const audience = normalizeAudience(raw);
  const rows =
    (applyDirectoryFilters(new FakeQuery(PEOPLE), audience) as FakeQuery)
      .rows;
  return snapshotAudience(rows.map(directoryRowToRecipient), new Set(), {
    excludeInternal: audience.mode !== "person",
    requireConsent: (profile) => requiresMarketingConsent(audience, profile),
  });
}

const pending = (snapshot: ReturnType<typeof snapshotOf>) =>
  snapshot.deliveries.filter((d) => d.status === "pending").map((d) =>
    d.recipient_email
  ).sort();

Deno.test("#4226 Everyone includes every group; a missing group fails", () => {
  const snapshot = snapshotOf({ mode: "everyone" });
  assertEquals(snapshot.matched, PEOPLE.length, "Everyone is the whole list");
  for (const group of EVERYONE_GROUPS) {
    assert(
      (snapshot.byGroup[group] ?? 0) > 0,
      `Everyone is missing the group "${group}"`,
    );
  }
  assertEquals(snapshot.byGroup, {
    explorer: 1,
    host: 1,
    both: 1,
    incomplete: 1,
    ticket_buyer_no_app: 1,
    host_contact_no_app: 1,
  });
  assertEquals(EVERYONE_GROUPS, [
    "explorer",
    "host",
    "both",
    "incomplete",
    "ticket_buyer_no_app",
    "host_contact_no_app",
  ]);
});

Deno.test("#4226 Everyone leaves out only what the rules exclude, counted by reason", () => {
  const snapshot = snapshotOf({ mode: "everyone" });
  assertEquals(pending(snapshot), [
    "ada@mingla-fixture.org",
    "both@mingla-fixture.org",
    "explorer@mingla-fixture.org",
    "host@mingla-fixture.org",
    "incomplete@mingla-fixture.org",
    "kemi@mingla-fixture.org",
  ]);
  assertEquals(snapshot.willReceive, 6);
  assertEquals(snapshot.internalExcluded, 1, "staff/test");
  assertEquals(snapshot.noContact, 1, "no valid email");
  assertEquals(snapshot.skippedOptOut, 1, "suppressed by the brand");
  assertEquals(snapshot.noConsent, 1, "the person's own no beats the host's");
});

Deno.test("#4226 Host contacts audience: anyone a host added, consent required", () => {
  const snapshot = snapshotOf({
    mode: "segment",
    filters: { userType: "host_contacts" },
  });
  // both, kemi, sam, bola, test, noemail.
  assertEquals(snapshot.matched, 6);
  assertEquals(pending(snapshot), [
    "both@mingla-fixture.org",
    "kemi@mingla-fixture.org",
  ]);
  assertEquals(snapshot.skippedOptOut, 1);
  assertEquals(snapshot.noConsent, 1);
  assertEquals(snapshot.internalExcluded, 1);
});

Deno.test("#4226 App status 'Host contact, no app' and the Source filter", () => {
  const noApp = snapshotOf({
    mode: "segment",
    filters: { appStatus: "host_contact_no_app" },
  });
  assertEquals(pending(noApp), ["kemi@mingla-fixture.org"]);
  const sourceHost = snapshotOf({
    mode: "segment",
    filters: { userType: "all", source: "host_contact" },
  });
  assertEquals(
    sourceHost.matched,
    6,
    "Source alone does not shrink to app users",
  );
  assertEquals(pending(sourceHost), [
    "both@mingla-fixture.org",
    "kemi@mingla-fixture.org",
  ]);
  const sourceTicket = snapshotOf({
    mode: "segment",
    filters: { source: "ticket_buyer" },
  });
  assertEquals(pending(sourceTicket), ["ada@mingla-fixture.org"]);
  let threw = "";
  try {
    normalizeAudience({ mode: "segment", filters: { source: "everyone" } });
  } catch (error) {
    threw = (error as Error).message;
  }
  assertEquals(threw, "audience_filter_invalid:source");
});

Deno.test("#4226 one host contact with no account, by email", () => {
  const one = snapshotOf({ mode: "person", email: "Kemi@mingla-fixture.org" });
  assertEquals(one.willReceive, 1);
  assertEquals(one.deliveries[0].profile_id, null);
  const suppressed = snapshotOf({
    mode: "person",
    email: "sam@mingla-fixture.org",
  });
  assertEquals(suppressed.willReceive, 0);
  assertEquals(appStatusLabel("host_contact_no_app"), "Host contact, no app");
});

Deno.test("#4226 the edge function reads the host-contact columns and keys unsubscribe by email", () => {
  for (
    const column of [
      "is_host_contact",
      "host_brand_ids",
      "host_city",
      "consent_basis",
    ]
  ) {
    assert(DIRECTORY_COLUMNS.split(",").includes(column), column);
  }
  const src = Deno.readTextFileSync(new URL("./index.ts", import.meta.url));
  // A host contact with no account gets a working List-Unsubscribe.
  assertStringIncludes(src, "recipient_email: recipientEmail.toLowerCase()");
  assertStringIncludes(src, '"List-Unsubscribe": `<${url}>`');
  assertStringIncludes(src, "groups: snapshot.byGroup");
  const audience = Deno.readTextFileSync(
    new URL("./audience.ts", import.meta.url),
  );
  assertEquals(
    /mode === "everyone"\) return query\.in\(/.test(audience),
    false,
    "no old 'people with an app' Everyone path",
  );
});
