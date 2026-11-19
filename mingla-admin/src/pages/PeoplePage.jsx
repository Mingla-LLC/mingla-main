// Issue #4130 (Wave 3) and #4226 — People: everyone Mingla can reach, by
// where they are in their journey.
//
//   - #4226 Phase 2 (spec D1, D7, D10, D11): tabs Explorers, Hosts, Both apps,
//     Signing up, No account yet (Bought a ticket / Host contact, never
//     bought) and Staff and test. Explorers and Hosts include people on both
//     apps, the same words Email uses.
//   - Every list, count, strip and filter option reads ONE server filter
//     (admin_people_filter / _facets / _filter_counts), the same one the Email
//     audience reads, so "Email these N people" reaches the same N.
//   - A stage strip filters the tab; filters only offer values that exist in
//     the tab, each with its count; "Clear filters" resets them; a filter
//     combination with nobody says so.
//   - Every row opens the person panel, people with no account included.
//   - Addresses: #/people?tab=hosts, &f=<filter> (opened from Email),
//     &person=<u:id | e:email> (panel), #/people?view=record&userId=<id> (the
//     full record). Old #/users, #/business-people, ?tab=incomplete,
//     ?tab=ticket-buyers and ?tab=host-contacts still land here.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, Users } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { FilterSelect } from "../components/ui/FilterSelect";
import { LoadError } from "../components/ui/LoadError";
import { EntityListView } from "../components/entity/EntityListView";
import { PersonDrawer } from "../components/people/PersonDrawer";
import { PeopleConsolePage } from "./PeopleConsolePage";
import { getPeopleFacets, getPeopleFilterCounts, listPeopleByFilter } from "../services/peopleService";
import { personDisplayName } from "../lib/peopleSegments";
import {
  JOURNEY_TABS,
  activityLabel,
  cleanFilter,
  confidenceLabel,
  decodeFilter,
  emailHrefFor,
  facetOptions,
  FILTER_LABELS,
  goingLabel,
  hostSummaryLabel,
  journeyTabFor,
  placeLabel,
  placeSourceLabel,
  sourceLabel,
  stageLabel,
  stripOptions,
  tabFilter,
} from "../lib/peopleFilter";
import { formatDate, timeAgo } from "../lib/formatters";

function readHash() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const userId = params.get("userId");
  return {
    tab: journeyTabFor(params.get("tab")).id,
    rawTab: params.get("tab"),
    // The panel: a person key, or an old account address (userId).
    personKey: params.get("person") || (userId && params.get("view") !== "record" ? `u:${userId}` : null),
    userId,
    view: params.get("view"),
    filter: decodeFilter(params.get("f")),
  };
}

function writeHash({ tab, personKey, filter }) {
  const params = new URLSearchParams();
  params.set("tab", tab);
  const clean = cleanFilter(filter);
  if (Object.keys(clean).length) params.set("f", JSON.stringify(clean));
  if (personKey) params.set("person", personKey);
  window.location.hash = `#/people?${params.toString()}`;
}

/** Split a filter from an address into the tab's strip value and its filters. */
function splitFilter(tab, filter) {
  const f = cleanFilter(filter);
  let strip = null;
  if (tab.strip === "track") {
    if (tab.stripOrder.includes(f.track)) strip = f.track;
  } else if (tab.strip && f[tab.strip]) {
    strip = f[tab.strip];
  }
  const rest = { ...f };
  delete rest.track;
  delete rest.search;
  if (tab.strip && tab.strip !== "track") delete rest[tab.strip];
  return { strip, filters: rest };
}

const muted = (text) => <span className="text-[var(--color-text-muted)]">{text}</span>;
const two = (top, bottom) => (
  <span className="flex min-w-0 flex-col">
    <span className="truncate text-[var(--color-text-primary)]">{top}</span>
    {bottom && <span className="truncate text-xs text-[var(--color-text-tertiary)]">{bottom}</span>}
  </span>
);

const PERSON_COLUMN = {
  key: "name",
  label: "Person",
  sortable: true,
  render: (_v, row) => two(
    <span className="font-medium">{personDisplayName(row)}</span>,
    row.email || (row.person_kind === "no_account_buyer" ? "Ticket buyer · no Mingla account" : null),
  ),
};
const STAGE_COLUMN = (label) => ({
  key: "stage_label",
  label,
  render: (v, row) => {
    const warm = row.host_next_step && row.host_next_step !== "repeat_seller" && row.host_next_step !== "team_member";
    const stuck = row.explorer_stage === "signing_up" || row.person_kind === "no_account_contact";
    return <Badge variant={warm || stuck ? "warning" : "success"}>{v || "—"}</Badge>;
  },
});
const SOURCE_COLUMN = { key: "source_label", label: "Source", render: (v, row) => two(v, row.confidence_label) };
const PLACE_COLUMN = { key: "place_label", label: "Place", render: (v, row) => two(v, row.place_source_label) };
const LAST_ACTIVE_COLUMN = {
  key: "last_active_at",
  label: "Last active",
  sortable: true,
  render: (v, row) => two(v ? timeAgo(v) : "Never", row.activity_label || null),
};
const JOINED_COLUMN = { key: "joined_at", label: "Joined", sortable: true, render: (v) => (v ? formatDate(v) : muted("–")) };

const COLUMNS = {
  explorers: [PERSON_COLUMN, STAGE_COLUMN("Stage"), SOURCE_COLUMN, PLACE_COLUMN, { key: "going_label", label: "Going" }, LAST_ACTIVE_COLUMN],
  hosts: [PERSON_COLUMN, STAGE_COLUMN("Next step"), SOURCE_COLUMN, PLACE_COLUMN, { key: "host_summary", label: "Brands" }, LAST_ACTIVE_COLUMN],
  both: [PERSON_COLUMN, STAGE_COLUMN("Stage"), SOURCE_COLUMN, PLACE_COLUMN, { key: "host_summary", label: "Brands" }, LAST_ACTIVE_COLUMN],
  signing: [PERSON_COLUMN, STAGE_COLUMN("Stopped at"), SOURCE_COLUMN, PLACE_COLUMN, JOINED_COLUMN, LAST_ACTIVE_COLUMN],
  noaccount: [
    PERSON_COLUMN,
    STAGE_COLUMN("Kind"),
    SOURCE_COLUMN,
    PLACE_COLUMN,
    { key: "bought_label", label: "Bought" },
    { key: "joined_at", label: "Last purchase or added", sortable: true, render: (_v, row) => two(formatDate(row.last_purchase_at || row.host_contact_added_at) || "–", row.emails_ok ? "Emails OK" : "No marketing email") },
  ],
  staff: [PERSON_COLUMN, STAGE_COLUMN("Kind"), SOURCE_COLUMN, PLACE_COLUMN, { key: "why_label", label: "Why it's here" }, LAST_ACTIVE_COLUMN],
};

const CSV_COLUMNS = [
  { key: "person_key", label: "Person key" },
  { key: "name", label: "Name" },
  { key: "email", label: "Email" },
  { key: "phone_e164", label: "Phone" },
  { key: "stage_label", label: "Stage / next step" },
  { key: "source_label", label: "Source" },
  { key: "confidence_label", label: "Source confidence" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
  { key: "place_source_label", label: "Place source" },
  { key: "going_label", label: "Going" },
  { key: "host_summary", label: "Brands" },
  { key: "joined_at", label: "Joined" },
  { key: "last_active_at", label: "Last active" },
  { key: "activity_label", label: "Activity" },
  { key: "emails_ok_label", label: "Emails OK" },
];

function flattenJourneyRow(row) {
  const bought = Number(row?.tickets_count) || 0;
  return {
    ...row,
    row_key: row?.person_key || row?.user_id || row?.email || "",
    stage_label: stageLabel(row),
    source_label: sourceLabel(row),
    confidence_label: confidenceLabel(row),
    place_label: placeLabel(row),
    place_source_label: placeSourceLabel(row),
    activity_label: activityLabel(row),
    going_label: goingLabel(row),
    host_summary: hostSummaryLabel(row),
    bought_label: bought ? `${bought} ${bought === 1 ? "ticket" : "tickets"}` : "Nothing bought",
    why_label: row?.email && /@usemingla\.com$/i.test(row.email) ? "Mingla email address" : "On the staff and test list, or a test-style email",
    emails_ok_label: row?.emails_ok ? "Yes" : "No",
  };
}

const EMPTY_TAB = {
  explorers: "No explorers yet. People who finish Explorer onboarding appear here.",
  hosts: "No hosts yet. People with a Host account or a role on a brand appear here.",
  both: "No one uses both apps yet.",
  signing: "No one is part-way through sign-up.",
  noaccount: "No ticket buyers or host contacts without an account.",
  staff: "No staff or test accounts.",
};

export function PeoplePage() {
  const [route, setRoute] = useState(readHash);
  const tab = journeyTabFor(route.tab);
  const initial = useMemo(() => splitFilter(tab, route.filter), [tab, route.filter]);
  const [strip, setStrip] = useState(initial.strip);
  const [filters, setFilters] = useState(initial.filters);
  const [clearVersion, setClearVersion] = useState(0);
  const [listVersion, setListVersion] = useState(0);
  const [tabCounts, setTabCounts] = useState(null);
  const [countsError, setCountsError] = useState(null);
  const [facets, setFacets] = useState(null);
  const [stripCounts, setStripCounts] = useState(null);
  const [facetsError, setFacetsError] = useState(null);
  const [facetsVersion, setFacetsVersion] = useState(0);
  const [visible, setVisible] = useState({ total: null, search: "" });

  useEffect(() => {
    const sync = () => setRoute(readHash());
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);

  // A new tab (or a filter in the address) starts the strip and filters over.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset on tab or address change
    setStrip(initial.strip);
    setFilters(initial.filters);
    setVisible({ total: null, search: "" });
  }, [initial]);

  const filter = useMemo(() => tabFilter(tab, { strip, filters }), [tab, strip, filters]);
  const filterKey = JSON.stringify(filter);

  const loadTabCounts = useCallback(async () => {
    setCountsError(null);
    try {
      setTabCounts(await getPeopleFilterCounts(Object.fromEntries(JOURNEY_TABS.map((t) => [t.id, { track: t.track }]))));
    } catch (err) {
      setTabCounts(null);
      setCountsError(err?.message || "Couldn't load the people counts.");
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load on open, like the other admin pages
    loadTabCounts();
  }, [loadTabCounts, listVersion]);

  // Facets (and the strip) for the current tab and filters.
  useEffect(() => {
    let live = true;
    const f = JSON.parse(filterKey);
    const stripCountsRequest = tab.strip === "track"
      ? getPeopleFilterCounts(Object.fromEntries(tab.stripOrder.map((value) => [value, { ...f, track: value }])))
      : Promise.resolve(null);
    // For a track strip the facets cover the whole tab, whichever part is chosen.
    Promise.all([getPeopleFacets(f), stripCountsRequest])
      .then(([result, counts]) => {
        if (!live) return;
        setFacets(result.facets);
        setStripCounts(counts);
        setFacetsError(null);
      })
      .catch((err) => {
        if (!live) return;
        setFacets(null);
        setFacetsError(err?.message || "Couldn't load the filter options.");
      });
    return () => { live = false; };
  }, [filterKey, tab, facetsVersion, listVersion]);

  const fetchPage = useCallback(
    async (query) => {
      const search = query.search || "";
      const result = await listPeopleByFilter(
        tabFilter(tab, { strip, filters, search }),
        { sortKey: query.sortKey, sortDir: query.sortDir, page: query.page, pageSize: query.pageSize },
      );
      setVisible({ total: result.total, search });
      return { ...result, rows: result.rows.map(flattenJourneyRow) };
    },
    // listVersion: a write in the panel reloads the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, filterKey, listVersion]
  );

  const strips = useMemo(() => stripOptions(tab, facets, stripCounts), [tab, facets, stripCounts]);
  const anyFilter = !!strip || Object.keys(cleanFilter(filters)).length > 0 || !!visible.search;

  const setFilter = (key, value) => setFilters((current) => {
    const next = { ...current };
    if (value) next[key] = value;
    else delete next[key];
    return next;
  });
  const clearAll = () => {
    setStrip(null);
    setFilters({});
    setClearVersion((v) => v + 1);
    setVisible({ total: null, search: "" });
    if (route.filter) writeHash({ tab: tab.id, personKey: null, filter: null });
  };

  const onChanged = useCallback(() => setListVersion((v) => v + 1), []);

  // The full record (edit details, beta, partner) of one person.
  if (route.view === "record" && route.userId) {
    return <PeopleConsolePage />;
  }

  const emailFilter = tabFilter(tab, { strip, filters, search: visible.search });
  const emailCount = visible.total;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="People"
        description="Everyone Mingla can reach, by where they are in their journey. Staff and test accounts are left out of every count except their own tab."
        actions={
          <a
            href={emailHrefFor(emailFilter)}
            aria-disabled={!emailCount}
            onClick={(e) => { if (!emailCount) e.preventDefault(); }}
            className={`inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-semibold ${emailCount ? "bg-[var(--color-text-primary)] text-[var(--color-background-primary)] hover:opacity-90" : "cursor-not-allowed bg-[var(--gray-200)] text-[var(--color-text-tertiary)]"}`}
            data-email-these
          >
            <Mail className="h-4 w-4" aria-hidden="true" />
            {emailCount === null ? "Email these people" : `Email these ${emailCount.toLocaleString()} ${emailCount === 1 ? "person" : "people"}`}
          </a>
        }
      />

      {countsError && <LoadError title="Couldn't load the people counts" message={countsError} onRetry={loadTabCounts} />}

      <Tabs
        tabs={JOURNEY_TABS.map((t) => ({
          id: t.id,
          label: tabCounts && Number.isFinite(Number(tabCounts[t.id])) ? `${t.label} · ${Number(tabCounts[t.id]).toLocaleString()}` : t.label,
        }))}
        activeTab={tab.id}
        onChange={(id) => writeHash({ tab: id, personKey: null, filter: null })}
      />

      <div role="tabpanel" id={`tabpanel-${tab.id}`} aria-labelledby={`tab-${tab.id}`} className="flex min-w-0 flex-col gap-4">
        <p className="text-sm text-[var(--color-text-secondary)]">{tab.note}</p>

        {facetsError && (
          <LoadError title="Couldn't load the filter options" message={facetsError} onRetry={() => setFacetsVersion((v) => v + 1)} />
        )}

        {strips.length > 0 && (
          <section aria-label={tab.stripTitle} className="flex flex-col gap-2" data-stage-strip>
            <p className="text-xs text-[var(--color-text-secondary)]">{tab.stripTitle}: click to filter, click again to clear</p>
            <div className="flex flex-wrap gap-2">
              {strips.map((s) => {
                const on = strip === s.value;
                return (
                  <button
                    key={s.value}
                    type="button"
                    aria-pressed={on}
                    disabled={!on && s.count === 0}
                    onClick={() => setStrip(on ? null : s.value)}
                    className={`flex min-w-[120px] flex-col items-start rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-primary)] hover:border-[var(--gray-300)]"}`}
                  >
                    <span className="text-lg font-semibold tabular-nums">{s.count.toLocaleString()}</span>
                    <span className="text-xs">{s.label}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3" data-people-filters>
          {tab.filters.map((key) => {
            const options = facetOptions(key, facets);
            const value = filters[key] || "";
            // A chosen value stays listed even when the other filters leave it empty.
            const withValue = value && !options.some((o) => o.value === value) ? [{ value, label: `${value} (0)` }, ...options] : options;
            return (
              <FilterSelect
                key={key}
                name={key}
                label={FILTER_LABELS[key]}
                value={value}
                options={[{ value: "", label: "Any" }, ...withValue]}
                onChange={(next) => setFilter(key, next)}
                disabled={!facets && !facetsError}
              />
            );
          })}
          {anyFilter && (
            <Button variant="secondary" size="sm" onClick={clearAll}>Clear filters</Button>
          )}
        </div>

        {visible.total === 0 && anyFilter && (
          <div className="flex flex-col items-start gap-2 rounded-xl border border-dashed border-[var(--gray-300)] px-4 py-4" role="status">
            <strong className="text-sm text-[var(--color-text-primary)]">Nobody matches these filters</strong>
            <span className="text-sm text-[var(--color-text-secondary)]">
              Each filter only lists values people in this tab have, so an empty list means this combination has nobody in it.
            </span>
            <Button variant="secondary" size="sm" onClick={clearAll}>Clear filters</Button>
          </div>
        )}

        <EntityListView
          key={`${tab.id}:${clearVersion}`}
          columns={COLUMNS[tab.id]}
          fetchPage={fetchPage}
          serverSort
          searchPlaceholder={tab.id === "noaccount" ? "Name, email, phone or brand" : "Name, email, phone or username"}
          rowKey={(row) => row.row_key}
          onRowClick={(row) => writeHash({ tab: tab.id, personKey: row.person_key, filter })}
          csv={{ columns: CSV_COLUMNS, filename: `people_${tab.id}` }}
          emptyMessage={anyFilter ? "Nobody matches these filters." : EMPTY_TAB[tab.id]}
          emptyIcon={Users}
        />
      </div>

      <PersonDrawer
        personKey={route.personKey}
        onClose={() => writeHash({ tab: tab.id, personKey: null, filter: route.filter })}
        onChanged={onChanged}
      />
    </div>
  );
}
