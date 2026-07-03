// ORCH-1271 [Admin authorization & audit FOUNDATION] — smoke-wire placeholder.
//
// Proves the reusable scaffolding (EntityListView / EntityDetailView /
// HighRiskActionModal) + the audited-write primitive round-trip render end-to-
// end, WITHOUT wiring any real business data. The list is fed a static in-memory
// demo dataset (clearly labelled). The ONLY live call is the "Run audited-write
// self-test", which invokes the golden reference RPC admin_audit_probe via
// adminWriteService.runAuditProbe — it writes an admin.audit_probe audit row and
// mutates NOTHING else.
//
// Domain pages (Person / Brand / Offerings / Money views) are wave 2 —
// ORCH-1272/1273/1274. This page intentionally references NO real domain table.

import { useState, useCallback } from "react";
import { EntityListView } from "../components/entity/EntityListView";
import { EntityDetailView } from "../components/entity/EntityDetailView";
import { HighRiskActionModal } from "../components/entity/HighRiskActionModal";
import { AlertCard, SectionCard } from "../components/ui/Card";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Building2, ShieldCheck } from "lucide-react";
import { runAuditProbe } from "../services/adminWriteService";

// ── Static demo dataset (scaffolding preview only — NOT live data). ───────────
const DEMO_ROWS = [
  { id: "d1", name: "Sunset Rooftop Co.", city: "Lagos",   status: "active",    joined: "2026-01-12" },
  { id: "d2", name: "Harbour Lights",     city: "London",  status: "active",    joined: "2026-02-03" },
  { id: "d3", name: "Desert Bloom",       city: "Doha",    status: "paused",    joined: "2026-02-27" },
  { id: "d4", name: "Riverside Sessions", city: "Austin",  status: "active",    joined: "2026-03-15" },
  { id: "d5", name: "Old Town Supper",    city: "Raleigh", status: "suspended", joined: "2026-04-01" },
];

const STATUS_VARIANT = { active: "success", paused: "warning", suspended: "error" };

function statusBadge(value) {
  return <Badge variant={STATUS_VARIANT[value] || "default"}>{value}</Badge>;
}

const COLUMNS = [
  { key: "name", label: "Name", sortable: true },
  { key: "city", label: "City", sortable: true },
  { key: "status", label: "Status", render: statusBadge },
  { key: "joined", label: "Joined", sortable: true },
];

const CSV = {
  columns: [
    { key: "name", label: "Name" },
    { key: "city", label: "City" },
    { key: "status", label: "Status" },
    { key: "joined", label: "Joined" },
  ],
  filename: "business_console_demo",
};

const FILTERS = [
  {
    key: "status",
    label: "Status",
    options: [
      { value: "active", label: "Active" },
      { value: "paused", label: "Paused" },
      { value: "suspended", label: "Suspended" },
    ],
  },
];

// Client-side fetchPage over the static demo rows — proves search / sort /
// filter / pagination / empty render against the SAME contract a real
// server-driven fetchPage would honor.
function demoFetchPage({ search, sortKey, sortDir, filters, page, pageSize }) {
  let out = DEMO_ROWS.slice();
  if (search) {
    const q = search.toLowerCase();
    out = out.filter(
      (r) => r.name.toLowerCase().includes(q) || r.city.toLowerCase().includes(q),
    );
  }
  if (filters?.status) {
    out = out.filter((r) => r.status === filters.status);
  }
  if (sortKey && sortDir) {
    out = out.sort((a, b) => {
      const cmp = String(a[sortKey]).localeCompare(String(b[sortKey]));
      return sortDir === "desc" ? -cmp : cmp;
    });
  }
  const total = out.length;
  const start = page * pageSize;
  return Promise.resolve({ rows: out.slice(start, start + pageSize), total });
}

export function BusinessConsolePage() {
  const [selected, setSelected] = useState(null);
  const [selfTestOpen, setSelfTestOpen] = useState(false);
  const [lastAuditId, setLastAuditId] = useState(null);

  // The ONE live call: round-trip the audited-write primitive.
  const runProbe = useCallback(async ({ reason }) => {
    const { data, error } = await runAuditProbe(reason, "business-console self-test");
    if (error) throw new Error(error.message || "audit probe failed");
    setLastAuditId(data);
  }, []);

  const selfTestAction = {
    label: "Run audited-write self-test",
    title: "Audited-write self-test",
    description:
      "Writes one admin.audit_probe row via the audited-write primitive to prove the guard + typed-reason + server-side audit seam. Touches no business data.",
    confirmLabel: "Run self-test",
    requireReason: true,
    onConfirm: runProbe,
  };

  return (
    <div className="py-8 flex flex-col gap-6">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="w-10 h-10 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center shrink-0">
          <Building2 className="w-5 h-5 text-[var(--color-brand-500)]" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">Business Console</h1>
          <p className="text-sm text-[var(--color-text-secondary)] mt-0.5">
            Foundation scaffolding — reusable list / detail / high-risk-action shells + audited-write primitive.
          </p>
        </div>
        <Button
          variant="secondary"
          size="md"
          icon={ShieldCheck}
          onClick={() => setSelfTestOpen(true)}
        >
          Run audited-write self-test
        </Button>
      </div>

      <AlertCard variant="info" title="Scaffolding preview — no live data (wave 2)">
        The list below is a static in-memory demo dataset that exercises search, sort, filter,
        pagination, CSV export, and the detail view. Real domain data (people, brands, offerings,
        money) lands in ORCH-1272 / 1273 / 1274.
      </AlertCard>

      {lastAuditId && (
        <AlertCard variant="success" title="Audited-write primitive proven">
          Last self-test wrote audit row <span className="font-mono">{lastAuditId}</span>.
        </AlertCard>
      )}

      {selected ? (
        <EntityDetailView
          header={{
            title: selected.name,
            subtitle: selected.city,
            badges: [{ label: selected.status, variant: STATUS_VARIANT[selected.status] || "default" }],
            backLabel: "Business Console",
            onBack: () => setSelected(null),
          }}
          sections={[
            {
              label: "Overview",
              fields: [
                { label: "Name", value: selected.name },
                { label: "City", value: selected.city },
                { label: "Status", value: selected.status, render: statusBadge },
                { label: "Joined", value: selected.joined },
              ],
            },
          ]}
          actions={[selfTestAction]}
        />
      ) : (
        <SectionCard noPadding>
          <div className="p-5">
            <EntityListView
              title="Sample partners (demo)"
              columns={COLUMNS}
              fetchPage={demoFetchPage}
              searchPlaceholder="Search name or city…"
              filters={FILTERS}
              pageSize={3}
              onRowClick={setSelected}
              csv={CSV}
              emptyMessage="No demo rows match your search"
              emptyIcon={Building2}
            />
          </div>
        </SectionCard>
      )}

      {/* Page-level self-test modal (top-level button). */}
      <HighRiskActionModal
        open={selfTestOpen}
        onClose={() => setSelfTestOpen(false)}
        title="Audited-write self-test"
        description="Writes one admin.audit_probe row via the audited-write primitive to prove the guard + typed-reason + server-side audit seam. Touches no business data."
        confirmLabel="Run self-test"
        requireReason
        onConfirm={runProbe}
        successMessage="Self-test complete — audit row written."
      />
    </div>
  );
}
