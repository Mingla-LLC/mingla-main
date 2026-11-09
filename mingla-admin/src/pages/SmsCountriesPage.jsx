// Issue #4273 (country switches) — SMS countries.
//
// Which payout countries hosts can send MARKETING texts to, and through which
// sender. One row per country: its price per text (sms_country_prices), its
// sender, whether "Mingla" must be registered first, and its switch. A change
// happens in a drawer that asks for a reason; the server
// (admin_set_sms_country_switch / admin_set_sms_country_readiness) refuses a
// change without one, refuses a country that isn't ready, refuses a stale
// write, and logs every change. Owner and admins only: the partner seat and
// everyone else see a card and no server call is made.
//
// Verification codes, tickets and RSVP texts never read these switches.
import { useCallback, useEffect, useRef, useState } from "react";
import { MessageSquare } from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Input, Toggle } from "../components/ui/Input";
import { DataTable } from "../components/ui/Table";
import { Drawer } from "../components/ui/Drawer";
import { LoadError } from "../components/ui/LoadError";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/formatters";
import {
  blockedWords,
  countryName,
  formatSmsPrice,
  planSmsCountryChange,
  reasonOk,
  registrationLabel,
  senderChangeable,
  senderLabel,
  senderSummaryWords,
  smsCountryErrorWords,
} from "../lib/smsCountries";
import { getSmsCountries, setSmsCountryReadiness, setSmsCountrySwitch } from "../services/smsCountriesService";

const PAGE_DESCRIPTION =
  "Which countries hosts can send marketing texts to. Verification codes, tickets and RSVP texts are not affected.";

function lastChangedWords(row) {
  if (!row.updatedAt) return "–";
  const by = row.updatedByEmail ? ` · ${String(row.updatedByEmail).split("@")[0]}` : "";
  return `${formatDate(row.updatedAt)}${by}`;
}

/** Owner and admins only; anyone else gets the card and no server call. */
export function SmsCountriesPage() {
  const { access } = useAuth();
  const role = access?.role;
  const allowed = role === "owner" || role === "admin";
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title="SMS countries" description={PAGE_DESCRIPTION} />
      {allowed ? (
        <SmsCountriesBoard />
      ) : (
        <AlertCard variant="info" title="Owner and admins only">
          Only the owner and admins can see and change SMS countries.
        </AlertCard>
      )}
    </div>
  );
}

function SmsCountriesBoard() {
  const { addToast } = useToast();
  const [rows, setRows] = useState([]);
  const [service, setService] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [changing, setChanging] = useState(null); // the row being changed
  const [form, setForm] = useState({ on: false, registrationDone: false, sender: null });
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
    setLoaded(false);
    setError(null);
    try {
      const data = await getSmsCountries();
      if (mounted.current) {
        setRows(data.countries);
        setService(data.marketingService);
        setLoaded(true);
      }
    } catch (err) {
      if (mounted.current) {
        setRows([]);
        setService(null);
        setError(smsCountryErrorWords(err, "load"));
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

  const openChange = (row) => {
    setChanging(row);
    setForm({
      on: Boolean(row.marketingEnabled),
      registrationDone: Boolean(row.registrationDoneAt),
      sender: row.sender,
    });
    setReason("");
    setSaveError("");
  };

  const plan = changing ? planSmsCountryChange(changing, form) : { steps: [], blocked: null };
  const name = changing ? countryName(changing.country) : "";
  const turningOn = changing ? form.on && !changing.marketingEnabled : false;
  const turningOff = changing ? !form.on && changing.marketingEnabled : false;
  const canSave = Boolean(changing) && plan.steps.length > 0 && !plan.blocked && reasonOk(reason) && !saving;

  const save = async () => {
    if (!changing) return;
    if (!reasonOk(reason)) {
      setSaveError("Add a reason first.");
      return;
    }
    if (plan.blocked) {
      setSaveError(blockedWords(plan.blocked));
      return;
    }
    if (plan.steps.length === 0) {
      setSaveError("Nothing to change.");
      return;
    }
    setSaving(true);
    setSaveError("");
    let expectedUpdatedAt = changing.updatedAt;
    try {
      for (const step of plan.steps) {
        const { data, error: rpcError } = step.kind === "switch"
          ? await setSmsCountrySwitch({ country: changing.country, on: step.on, reason: reason.trim(), expectedUpdatedAt })
          : await setSmsCountryReadiness({
            country: changing.country,
            registrationDone: step.registrationDone,
            sender: step.sender,
            reason: reason.trim(),
            expectedUpdatedAt,
          });
        if (rpcError) throw rpcError;
        expectedUpdatedAt = data?.updatedAt ?? expectedUpdatedAt;
      }
      const switched = plan.steps.find((s) => s.kind === "switch");
      addToast({
        variant: "success",
        title: switched
          ? `${name}: marketing texts ${switched.on ? "on" : "off"}.`
          : `${name}: saved.`,
        description: "Logged with your reason.",
      });
      setChanging(null);
      await load();
    } catch (err) {
      if (mounted.current) {
        setSaveError(smsCountryErrorWords(err));
        // A partial save (readiness saved, switch refused) is real: reload so
        // the table shows what the server now holds.
        void load();
      }
    } finally {
      if (mounted.current) setSaving(false);
    }
  };

  const onCount = rows.filter((r) => r.marketingEnabled).length;

  const columns = [
    {
      key: "country",
      label: "Country",
      sortable: true,
      render: (v) => (
        <span className="text-sm text-[var(--color-text-primary)]">
          {countryName(v)} <span className="font-mono text-xs text-[var(--color-text-secondary)]">{v}</span>
        </span>
      ),
    },
    {
      key: "price",
      label: "Price per text",
      render: (v) => <span className="whitespace-nowrap text-sm text-[var(--color-text-secondary)]">{formatSmsPrice(v)}</span>,
    },
    {
      key: "sender",
      label: "Sender",
      render: (v) => <span className="text-sm text-[var(--color-text-secondary)]">{senderLabel(v)}</span>,
    },
    {
      key: "registrationRequired",
      label: "Registration",
      render: (_v, r) => <span className="text-sm text-[var(--color-text-secondary)]">{registrationLabel(r)}</span>,
    },
    {
      key: "marketingEnabled",
      label: "Marketing texts",
      sortable: true,
      render: (v) => <Badge variant={v ? "success" : "default"}>{v ? "On" : "Off"}</Badge>,
    },
    {
      key: "updatedAt",
      label: "Last changed",
      sortable: true,
      render: (_v, r) => <span className="whitespace-nowrap text-sm text-[var(--color-text-secondary)]">{lastChangedWords(r)}</span>,
    },
    {
      key: "_change",
      label: "",
      render: (_v, r) => (
        <Button size="sm" variant="secondary" onClick={() => openChange(r)} aria-label={`Change ${countryName(r.country)}`}>
          Change
        </Button>
      ),
    },
  ];

  const summary = senderSummaryWords({ loaded: loaded && !loading && !error, service, count: rows.length, onCount });

  return (
    <>
      {summary && <p className="text-sm text-[var(--color-text-secondary)]">{summary}</p>}

      {error ? (
        <LoadError title="Couldn't load SMS countries" message={error} onRetry={load} />
      ) : (
        <SectionCard noPadding>
          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            emptyIcon={MessageSquare}
            emptyMessage="No countries set up yet."
            getRowId={(r) => r.country}
          />
        </SectionCard>
      )}

      <Drawer
        open={!!changing}
        onClose={() => !saving && setChanging(null)}
        title={changing ? `${name} (${changing.country})` : ""}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" disabled={saving} onClick={() => setChanging(null)}>Cancel</Button>
            <Button variant="primary" loading={saving} disabled={!canSave} onClick={save}>
              Save
            </Button>
          </div>
        }
      >
        {changing ? (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-[var(--color-text-secondary)]">
              {formatSmsPrice(changing.price)} · {senderLabel(changing.sender)} · Registration: {registrationLabel(changing)}
            </p>
            {changing.note && <p className="text-sm text-[var(--color-text-secondary)]">Twilio note: {changing.note}</p>}

            <Toggle
              label="Marketing texts on"
              checked={form.on}
              disabled={saving}
              onChange={(next) => setForm((f) => ({ ...f, on: next }))}
            />
            {plan.blocked && (
              <p role="alert" className="text-sm text-[var(--color-error-700)]">
                Can't turn on yet: {blockedWords(plan.blocked)}
              </p>
            )}

            {changing.registrationRequired && (
              <label className="inline-flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                <input
                  type="checkbox"
                  checked={form.registrationDone}
                  disabled={saving}
                  onChange={(e) => setForm((f) => ({ ...f, registrationDone: e.target.checked }))}
                />
                Registration done (Twilio approved "Mingla" for this country)
              </label>
            )}

            {senderChangeable(changing.country) && (
              <label className="inline-flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
                <input
                  type="checkbox"
                  checked={
                    changing.sender === "needs_local_number"
                      ? form.sender === "marketing_service"
                      : form.sender === "needs_local_number"
                  }
                  disabled={saving}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setForm((f) => ({
                      ...f,
                      sender: changing.sender === "needs_local_number"
                        ? (checked ? "marketing_service" : "needs_local_number")
                        : (checked ? "needs_local_number" : "marketing_service"),
                    }));
                  }}
                />
                {changing.sender === "needs_local_number"
                  ? "Local number added in Twilio (send through the Mingla marketing service)"
                  : "Needs a local number (the letters sender doesn't work here)"}
              </label>
            )}

            {turningOn && !plan.blocked && (
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                Turn marketing texts ON for {name}? Hosts' next sends will text people there.
              </p>
            )}
            {turningOff && (
              <p className="text-sm font-medium text-[var(--color-text-primary)]">
                Turn marketing texts OFF for {name}? Hosts' next sends will skip people there.
              </p>
            )}

            <Input
              label="Reason (saved with your name)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. UK first, test text confirmed"
            />
            {saveError && <p role="alert" className="text-sm text-[var(--color-error-700)]">{saveError}</p>}
          </div>
        ) : null}
      </Drawer>
    </>
  );
}
