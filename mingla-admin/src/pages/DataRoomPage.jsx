// Issue #4130 (Wave 5) — Data room (#/data-room).
//
// What is working in Mingla and what is not, for both sides of the
// marketplace, plus the private documents. Owners, admins and founding
// partners only: the page is behind the data_room area and every number is a
// gated, aggregate-only read (admin_data_room_*, services/
// dataRoomAnalyticsService.js). Staff and test accounts are left out the same
// way as on the People page. Numbers come from the nightly snapshot, or live
// for today until tonight's snapshot runs; each card says which.
//
// Address: #/data-room?tab=<overview|explorers|hosts|funnels|retention|usage|documents>&asOf=YYYY-MM-DD
// States: loading (skeletons), error (LoadError + Retry, never zeros),
// empty (says what will appear), populated.
import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "../components/ui/PageHeader";
import { Tabs } from "../components/ui/Tabs";
import { DATA_ROOM_TABS, dataRoomTabFor } from "../lib/dataRoomAnalytics";
import { getDataRoomSnapshotDates } from "../services/dataRoomAnalyticsService";
import { useDataRoomSection } from "../hooks/useDataRoomSection";
import { DataRoomOverview } from "../components/dataRoom/DataRoomOverview";
import { DataRoomTab } from "../components/dataRoom/DataRoomTabs";
import { DataRoomDocuments } from "../components/dataRoom/DataRoomDocuments";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function readHash() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const asOf = params.get("asOf");
  return { tab: dataRoomTabFor(params.get("tab")).id, asOf: asOf && DAY.test(asOf) ? asOf : null };
}

function writeHash({ tab, asOf }) {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (asOf) params.set("asOf", asOf);
  window.location.hash = `#/data-room?${params.toString()}`;
}

function AsOfPicker({ value, onChange }) {
  const [dates, setDates] = useState([]);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    getDataRoomSnapshotDates()
      .then((d) => { if (live) setDates(d); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  return (
    <label className="flex items-center gap-2 text-sm text-[var(--color-text-secondary)]">
      As of
      <select
        aria-label="As of"
        value={value || ""}
        onChange={(e) => onChange(e.target.value || null)}
        className="min-h-9 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-2 text-sm text-[var(--color-text-primary)]"
      >
        <option value="">Today</option>
        {dates.filter((d) => DAY.test(d)).map((d) => <option key={d} value={d}>{d}</option>)}
      </select>
      {failed ? <span className="text-xs text-[var(--color-error-700)]">Couldn&apos;t list stored days</span> : null}
    </label>
  );
}

export function DataRoomPage() {
  const [route, setRoute] = useState(readHash);
  useEffect(() => {
    const onHash = () => setRoute(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  const { tab, asOf } = route;
  const go = useCallback((next) => writeHash({ tab, asOf, ...next }), [tab, asOf]);

  const on = (...tabs) => tabs.includes(tab);
  const loads = {
    users: useDataRoomSection("users", asOf, on("overview")),
    overview: useDataRoomSection("overview", asOf, on("overview")),
    explorers: useDataRoomSection("explorers", asOf, on("explorers")),
    hosts: useDataRoomSection("hosts", asOf, on("hosts")),
    funnels: useDataRoomSection("funnels", asOf, on("overview", "funnels")),
    retention: useDataRoomSection("retention", asOf, on("overview", "retention")),
    money: useDataRoomSection("money", asOf, on("overview")),
  };

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Data room"
        description="What is working in Mingla and what is not, for both sides of the marketplace, and the private company documents. For owners, admins and founding partners."
        actions={tab === "documents" || tab === "usage" ? null : <AsOfPicker value={asOf} onChange={(d) => go({ asOf: d })} />}
      />
      <Tabs tabs={DATA_ROOM_TABS} activeTab={tab} onChange={(id) => go({ tab: id })} />
      <div role="tabpanel" id={`tabpanel-${tab}`} aria-labelledby={`tab-${tab}`} className="min-w-0">
        {tab === "overview" ? <DataRoomOverview loads={loads} /> : null}
        {tab === "documents" ? <DataRoomDocuments /> : null}
        {tab !== "overview" && tab !== "documents" ? <DataRoomTab tab={tab} loads={loads} /> : null}
      </div>
    </div>
  );
}
