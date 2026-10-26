// Issue #4130 (Wave 4b) — Feature flags, out of Settings onto their own page.
//
// One table: the flag, what it does, on or off, the issue it belongs to, when
// it last changed (and, for changes made here, who and why). Changing a flag
// changes the live apps for everyone, so it happens in a drawer that asks for
// a reason; the server (admin_set_feature_flag) refuses a change without one
// and logs every change. There is no one-click toggle and no delete here.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Flag } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input } from "../components/ui/Input";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable } from "../components/ui/Table";
import { Drawer } from "../components/ui/Drawer";
import { LoadError } from "../components/ui/LoadError";
import { useToast } from "../context/ToastContext";
import { formatDate } from "../lib/formatters";
import { canChangeFlag, flagChange, flagIssue } from "../lib/systemPages";
import { fetchFeatureFlagsBoard, setFeatureFlag, systemErrorWords } from "../services/systemPagesService";

const ISSUE_URL = "https://github.com/Mingla-LLC/mingla-main/issues/";

function lastChangedWords(row) {
  const when = row.last_logged_at || row.updated_at;
  if (!when) return "–";
  const by = row.last_changed_by ? ` · ${row.last_changed_by.split("@")[0]}` : "";
  return `${formatDate(when)}${by}`;
}

export function FeatureFlagsPage() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [changing, setChanging] = useState(null); // the row being changed
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchFeatureFlagsBoard();
      if (mounted.current) setRows(data);
    } catch (err) {
      if (mounted.current) {
        setRows([]);
        setError(systemErrorWords(err));
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    // The first server read; state changes happen inside the async loader.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.flag_key?.toLowerCase().includes(q) || r.description?.toLowerCase().includes(q));
  }, [rows, search]);

  const onCount = rows.filter((r) => r.is_enabled).length;
  const lastChange = rows.reduce((max, r) => {
    const t = Date.parse(r.last_logged_at || r.updated_at || "");
    return Number.isFinite(t) && t > max ? t : max;
  }, 0);

  const openChange = (row) => {
    setChanging(row);
    setReason("");
    setSaveError("");
  };

  const confirmChange = async () => {
    if (!changing || !canChangeFlag(reason)) {
      setSaveError("Add a reason first.");
      return;
    }
    const change = flagChange(changing);
    setSaving(true);
    setSaveError("");
    try {
      const result = await setFeatureFlag(changing.flag_key, change.next, reason.trim());
      addToast({
        variant: "success",
        title: result?.changed === false
          ? `${changing.flag_key} was already ${change.next ? "on" : "off"}`
          : `${changing.flag_key} is ${change.next ? "on" : "off"}`,
        description: result?.changed === false ? "Nothing changed." : "Logged with your reason.",
      });
      setChanging(null);
      await load();
    } catch (err) {
      if (mounted.current) setSaveError(systemErrorWords(err));
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const columns = [
    {
      key: "flag_key",
      label: "Flag",
      sortable: true,
      render: (v) => <span className="break-all font-mono text-xs text-[var(--color-text-primary)]">{v}</span>,
    },
    {
      key: "description",
      label: "What it does",
      render: (v) => <span className="text-sm text-[var(--color-text-secondary)]">{v || "–"}</span>,
    },
    {
      key: "is_enabled",
      label: "State",
      sortable: true,
      render: (v) => <Badge variant={v ? "success" : "default"}>{v ? "On" : "Off"}</Badge>,
    },
    {
      key: "issue",
      label: "Issue",
      render: (_v, r) => {
        const issue = flagIssue(r);
        return issue ? (
          <a className="text-sm text-[var(--color-brand-600)] hover:underline" href={`${ISSUE_URL}${issue}`} target="_blank" rel="noopener noreferrer">
            #{issue}
          </a>
        ) : (
          "–"
        );
      },
    },
    {
      key: "updated_at",
      label: "Last changed",
      sortable: true,
      render: (_v, r) => <span className="whitespace-nowrap text-sm text-[var(--color-text-secondary)]">{lastChangedWords(r)}</span>,
    },
    {
      key: "_change",
      label: "",
      render: (_v, r) => (
        <Button size="sm" variant="secondary" onClick={() => openChange(r)}>
          {flagChange(r).button}
        </Button>
      ),
    },
  ];

  const change = changing ? flagChange(changing) : null;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title="Feature flags"
        description={
          loading || error
            ? "Which features are on, who changed them and why. Every change asks you to confirm."
            : `${rows.length} flags · ${onCount} on${lastChange ? ` · last changed ${formatDate(new Date(lastChange).toISOString())}` : ""}. Every change asks you to confirm.`
        }
      />

      {error ? (
        <LoadError title="Couldn't load the flags" message={error} onRetry={load} />
      ) : (
        <SectionCard noPadding>
          <div className="p-4">
            <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} onClear={() => setSearch("")} placeholder="Search flags" />
          </div>
          <DataTable
            columns={columns}
            rows={filtered}
            loading={loading}
            emptyIcon={Flag}
            emptyMessage={search ? "No flags match that search." : "No flags yet. Flags added by engineering appear here."}
            getRowId={(r) => r.flag_key}
          />
        </SectionCard>
      )}

      <Drawer
        open={!!changing}
        onClose={() => !saving && setChanging(null)}
        title={change?.title || ""}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={saving} onClick={() => setChanging(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} disabled={!canChangeFlag(reason)} onClick={confirmChange}>
              {change?.confirm}
            </Button>
          </div>
        }
      >
        {changing ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[var(--color-text-primary)]">
              This changes the live apps for everyone straight away.
            </p>
            {changing.description && <p className="text-sm text-[var(--color-text-secondary)]">{changing.description}</p>}
            <Input
              label="Reason (saved with your name)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. turning on for the Lagos launch"
            />
            {saveError && <p role="alert" className="text-sm text-[var(--color-error-700)]">{saveError}</p>}
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
