// Issue #4130 (Wave 3) — People: everyone with a Mingla account, split by how
// they use Mingla. Replaces the old Users page and the business People console.
//
//   - Tabs Explorers / Hosts / Both / Didn't finish sign-up / Staff and test,
//     with counts from admin_people_segments (staff and test are left out of
//     every other count). A failed count load shows Retry, never 0.
//   - #4226: a "Ticket buyers, no app" tab lists everyone with a paid ticket
//     who has not finished Explorer onboarding, including people with no
//     account (from the same server list the Email audiences read). Account
//     rows on every tab carry their ticket facts.
//   - Each tab is a server-paged list (admin_list_people): search, country,
//     joined; sort and CSV export cover the whole filtered list.
//   - A row opens the person drawer; every write lives there (PersonDrawer).
//   - Addresses: #/people?tab=hosts, #/people?tab=explorers&userId=<id> (drawer),
//     #/people?view=record&userId=<id> (the full record: edit details, beta,
//     partner). Old #/users and #/business-people links redirect here.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { Badge } from "../components/ui/Badge";
import { LoadError } from "../components/ui/LoadError";
import { EntityListView } from "../components/entity/EntityListView";
import { PersonDrawer } from "../components/people/PersonDrawer";
import { PeopleConsolePage } from "./PeopleConsolePage";
import { getPeopleSegments, listPeople } from "../services/peopleService";
import {
  PEOPLE_TABS,
  flattenPersonRow,
  marketingConsent,
  bestReadiness,
  peopleTabFor,
  peopleTabLabel,
  personDisplayName,
} from "../lib/peopleSegments";
import { formatDate, timeAgo } from "../lib/formatters";

function readHash() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  return {
    tab: peopleTabFor(params.get("tab")).id,
    userId: params.get("userId"),
    view: params.get("view"),
  };
}

function writeHash({ tab, userId }) {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (userId) params.set("userId", userId);
  window.location.hash = `#/people?${params.toString()}`;
}

const muted = (text) => <span className="text-[var(--color-text-muted)]">{text}</span>;

const NAME_COLUMN = {
  key: "name",
  label: "Name",
  sortable: true,
  render: (_v, row) => (
    <span className="flex min-w-0 flex-col">
      <span className="truncate font-medium text-[var(--color-text-primary)]">
        {personDisplayName(row)}
        {row.banned && (
          <Badge variant="error" className="ml-2">Banned</Badge>
        )}
        {row.is_ticket_holder && row.segment !== "ticket_buyer_no_app" && (
          <Badge variant="info" className="ml-2">Ticket buyer</Badge>
        )}
      </span>
      {row.email && <span className="truncate text-xs text-[var(--color-text-tertiary)]">{row.email}</span>}
    </span>
  ),
};
const COUNTRY_COLUMN = { key: "country", label: "Country", render: (v) => v || muted("Not given") };
const JOINED_COLUMN = { key: "joined_at", label: "Joined", sortable: true, render: (v) => formatDate(v) };
const LAST_ACTIVE_COLUMN = {
  key: "last_active_at",
  label: "Last active",
  sortable: true,
  render: (v) => (v ? timeAgo(v) : muted("Never")),
};
const count = (key, label) => ({
  key,
  label,
  render: (v) => <span className="tabular-nums">{Number(v || 0).toLocaleString()}</span>,
});

const HOST_COLUMNS = [
  NAME_COLUMN,
  { key: "brand_names", label: "Brands", render: (v) => v || muted("No brand yet") },
  { key: "main_role", label: "Role", render: (v) => v || muted("–") },
  {
    key: "payments_label",
    label: "Payments ready",
    render: (_v, row) => {
      const r = bestReadiness(row.brands);
      return r ? <Badge variant={r.variant}>{r.short}</Badge> : muted("–");
    },
  },
  count("live_offerings", "Live offerings"),
  COUNTRY_COLUMN,
  JOINED_COLUMN,
];

// #4226: the ticket-buyer tab. Sorting "Joined" means first ticket, "Last
// active" means latest ticket (the server maps both).
const TICKET_BUYER_COLUMNS = [
  { ...NAME_COLUMN, label: "Name / email" },
  { key: "app_status_label", label: "App status" },
  { key: "event_city", label: "City", render: (v) => v || muted("Not known") },
  { key: "country", label: "Country", render: (v) => v || muted("Not known") },
  count("tickets", "Tickets"),
  { key: "spent_label", label: "Spent" },
  { key: "last_purchase_at", label: "Last purchase", sortable: true, render: (v) => (v ? formatDate(v) : muted("–")) },
  {
    key: "emails_ok_label",
    label: "Emails OK",
    render: (_v, row) => {
      const c = marketingConsent(row.marketing_consent);
      return <Badge variant={c.variant}>{c.label}</Badge>;
    },
  },
];

const COLUMNS = {
  explorer: [NAME_COLUMN, COUNTRY_COLUMN, LAST_ACTIVE_COLUMN, count("saves", "Saves"), count("tickets", "Tickets"), count("friends", "Friends"), JOINED_COLUMN],
  host: HOST_COLUMNS,
  both: [...HOST_COLUMNS.slice(0, 6), { ...LAST_ACTIVE_COLUMN, label: "Last active in Explorer" }, JOINED_COLUMN],
  incomplete: [
    NAME_COLUMN,
    { key: "sign_in_label", label: "Signs in with" },
    { key: "got_as_far", label: "Got as far as" },
    JOINED_COLUMN,
  ],
  internal: [NAME_COLUMN, { key: "internal_reason", label: "Why it's here" }, LAST_ACTIVE_COLUMN, JOINED_COLUMN],
  ticket_buyer_no_app: TICKET_BUYER_COLUMNS,
};

// #4226: ticket facts on every export.
const CSV_TICKETS = [
  { key: "tickets_held", label: "Tickets held" },
  { key: "spent_label", label: "Spent" },
  { key: "last_purchase_at", label: "Last purchase" },
  { key: "event_city", label: "Event city" },
  { key: "emails_ok_label", label: "Emails OK" },
];

const CSV_BASE = [
  { key: "id", label: "ID" },
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "country", label: "Country" },
  { key: "joined_at", label: "Joined" },
  { key: "last_active_at", label: "Last active" },
];
const CSV_EXTRA = {
  explorer: [{ key: "saves", label: "Saves" }, { key: "tickets", label: "Tickets" }, { key: "friends", label: "Friends" }],
  host: [{ key: "brand_names", label: "Brands" }, { key: "main_role", label: "Role" }, { key: "payments_label", label: "Payments ready" }, { key: "live_offerings", label: "Live offerings" }],
  both: [{ key: "brand_names", label: "Brands" }, { key: "main_role", label: "Role" }, { key: "payments_label", label: "Payments ready" }, { key: "live_offerings", label: "Live offerings" }],
  incomplete: [{ key: "sign_in_label", label: "Signs in with" }, { key: "got_as_far", label: "Got as far as" }],
  internal: [{ key: "internal_reason", label: "Why it's here" }],
};

const CSV_TICKET_BUYERS = [
  { key: "id", label: "Account ID" },
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "app_status_label", label: "App status" },
  { key: "event_city", label: "Event city" },
  { key: "country", label: "Country" },
  { key: "tickets", label: "Tickets" },
  { key: "orders", label: "Orders" },
  { key: "spent_label", label: "Spent" },
  { key: "first_purchase_at", label: "First purchase" },
  { key: "last_purchase_at", label: "Last purchase" },
  { key: "brands_bought_names", label: "Brands bought from" },
  { key: "emails_ok_label", label: "Emails OK" },
];

function csvColumnsFor(segment) {
  if (segment === "ticket_buyer_no_app") return CSV_TICKET_BUYERS;
  return [...CSV_BASE, ...CSV_EXTRA[segment], ...CSV_TICKETS];
}

const EMPTY = {
  explorer: "No explorers match. People who finish Explorer onboarding appear here.",
  host: "No hosts match. People with a business account or a role on a brand appear here.",
  both: "No one matches. People who host and also finished Explorer onboarding appear here.",
  incomplete: "No one matches. People who signed in but never finished either app's setup appear here.",
  internal: "No staff or test accounts match. Accounts marked as staff or test, or with a usemingla.com or example.com email, or \"test\" as its own word before the @, appear here.",
  ticket_buyer_no_app: "No ticket buyers match. People who bought or were given a ticket and haven't finished setting up the Explorer app appear here, with or without an account.",
};

const JOINED_OPTIONS = [
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
];

export function PeoplePage() {
  const [route, setRoute] = useState(readHash);
  const [counts, setCounts] = useState(null);
  const [countsError, setCountsError] = useState(null);
  const [countsLoading, setCountsLoading] = useState(true);
  const [listVersion, setListVersion] = useState(0);

  useEffect(() => {
    const sync = () => setRoute(readHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  const loadCounts = useCallback(async () => {
    setCountsLoading(true);
    setCountsError(null);
    try {
      setCounts(await getPeopleSegments());
    } catch (err) {
      setCounts(null);
      setCountsError(err?.message || "Couldn't load the people counts.");
    } finally {
      setCountsLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load on open, like the other admin pages
    loadCounts();
  }, [loadCounts]);

  const tab = peopleTabFor(route.tab);
  const segment = tab.segment;

  const fetchPage = useCallback(
    async (query) => {
      const result = await listPeople(segment, query);
      return { ...result, rows: result.rows.map(flattenPersonRow) };
    },
    // listVersion: a write in the drawer reloads the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [segment, listVersion]
  );

  const filters = useMemo(() => {
    const countries = Array.isArray(counts?.countries) ? counts.countries : [];
    return [
      ...(countries.length ? [{ key: "country", label: "All countries", options: countries.map((c) => ({ value: c, label: c })) }] : []),
      { key: "joined", label: "Joined any time", options: JOINED_OPTIONS },
    ];
  }, [counts]);

  // "Joined" on this tab is the first ticket, so it reads "First ticket".
  const ticketBuyerFilters = useMemo(
    () => filters.map((f) => (f.key === "joined" ? { ...f, label: "First ticket any time" } : f)),
    [filters]
  );

  const onChanged = useCallback(() => {
    loadCounts();
    setListVersion((v) => v + 1);
  }, [loadCounts]);

  // The full record (edit details, beta, partner) of one person.
  if (route.view === "record" && route.userId) {
    return <PeopleConsolePage />;
  }

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="People"
        description="Everyone with a Mingla account, split by how they use Mingla, plus ticket buyers who don't have the Explorer app yet. Staff and test accounts are left out of every count."
      />

      {countsError && (
        <LoadError title="Couldn't load the people counts" message={countsError} onRetry={loadCounts} retrying={countsLoading} />
      )}

      <Tabs
        tabs={PEOPLE_TABS.map((t) => ({ id: t.id, label: peopleTabLabel(t, countsError ? null : counts) }))}
        activeTab={tab.id}
        onChange={(id) => writeHash({ tab: id, userId: null })}
      />

      <div role="tabpanel" id={`tabpanel-${tab.id}`} aria-labelledby={`tab-${tab.id}`}>
        <EntityListView
          key={tab.id}
          columns={COLUMNS[segment]}
          fetchPage={fetchPage}
          serverSort
          searchPlaceholder={segment === "ticket_buyer_no_app" ? "Name, email, phone or city" : "Name, email or phone"}
          filters={segment === "ticket_buyer_no_app" ? ticketBuyerFilters : filters}
          rowKey={(row) => row.row_key}
          onRowClick={segment === "ticket_buyer_no_app" ? undefined : (row) => writeHash({ tab: tab.id, userId: row.id })}
          csv={{ columns: csvColumnsFor(segment), filename: `people_${tab.id}` }}
          emptyMessage={EMPTY[segment]}
          emptyIcon={Users}
        />
      </div>

      <PersonDrawer
        userId={route.userId}
        onClose={() => writeHash({ tab: tab.id, userId: null })}
        onChanged={onChanged}
      />
    </div>
  );
}

