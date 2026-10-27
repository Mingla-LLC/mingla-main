// Issue #4130 (Wave 2b) — Pricing and limits › Messaging limits.
//
// Defaults for every brand, and each brand's usage this month against its
// limits. Raising one brand's limits (with an end date and a reason) or
// changing the defaults happens in a panel and is confirmed before it is
// saved; the server checks the admin, records who did it and applies the new
// limits to the next blast straight away (biz_assert_brand_blast_allowance_v1).
import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, MessageSquare, Bell, AlertTriangle } from "lucide-react";
import { SectionCard, AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Badge } from "../ui/Badge";
import { Drawer } from "../ui/Drawer";
import { LoadError } from "../ui/LoadError";
import { Skeleton } from "../ui/Skeleton";
import { useToast } from "../../context/ToastContext";
import { formatDate } from "../../lib/formatters";
import {
  endsAtFromDay,
  formatLimit,
  formatUsage,
  limitSourceLabel,
  messagingLimitErrorMessage,
  parseLimitInput,
  parseWeekWarningInput,
  untilOptions,
  usagePercent,
  usageTone,
} from "../../lib/messagingLimits";
import { formatMinor } from "../../lib/saleEarnings";
import {
  clearBrandMessagingLimits,
  getMessagingLimitsOverview,
  setBrandMessagingLimits,
  setMessagingLimitDefaults,
} from "../../services/messagingLimitsService";

const BAR_TONE = {
  default: "bg-[var(--color-brand-500)]",
  warning: "bg-[#f59e0b]",
  error: "bg-[#ef4444]",
};

function UsageCell({ used, limit }) {
  const pct = usagePercent(used, limit);
  const tone = usageTone(used, limit);
  return (
    <div className="flex items-center gap-2">
      {pct !== null && (
        <div className="h-2 w-20 shrink-0 overflow-hidden rounded-full bg-[var(--gray-100)]" aria-hidden="true">
          <div className={`h-full ${BAR_TONE[tone]}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      <span className="tabular-nums">{formatUsage(used, limit)}</span>
    </div>
  );
}

function monthLabel(iso) {
  if (!iso) return "This month";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
  } catch {
    return "This month";
  }
}

const EMPTY_FORM = { email: "", sms: "", push: "", week: "", until: "this_month", day: "", reason: "" };

export function MessagingLimitsPanel() {
  const { addToast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  // panel: null | { mode: "defaults" } | { mode: "brand", brandId }
  const [panel, setPanel] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [confirming, setConfirming] = useState(null); // { kind: "save" | "clear", payload, summary }
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setData(await getMessagingLimitsOverview());
    } catch (err) {
      setLoadError(err.message || "Couldn't load messaging limits.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const defaults = data?.defaults ?? null;
  const brands = useMemo(() => data?.brands ?? [], [data]);
  const panelBrand = panel?.mode === "brand" ? brands.find((b) => b.brand_id === panel.brandId) ?? null : null;
  const until = untilOptions();

  const openDefaults = () => {
    if (!defaults) return;
    setForm({
      ...EMPTY_FORM,
      email: String(defaults.email_monthly),
      sms: String(defaults.sms_monthly),
      push: defaults.push_monthly === null ? "" : String(defaults.push_monthly),
      week: String(defaults.week_warning_at),
    });
    setFormErrors({});
    setConfirming(null);
    setSaveError(null);
    setPanel({ mode: "defaults" });
  };

  const openBrand = (row) => {
    const firstBrand = row ?? brands[0];
    if (!firstBrand) return;
    const o = firstBrand.override;
    setForm({
      ...EMPTY_FORM,
      email: String(o?.email_monthly ?? firstBrand.email_monthly),
      sms: String(o?.sms_monthly ?? firstBrand.sms_monthly),
      push: (o ? o.push_monthly : firstBrand.push_monthly) === null ? "" : String(o ? o.push_monthly : firstBrand.push_monthly),
      week: String(o?.week_warning_at ?? firstBrand.week_warning_at),
      until: o && o.active && o.ends_at === null ? "none" : "this_month",
    });
    setFormErrors({});
    setConfirming(null);
    setSaveError(null);
    setPanel({ mode: "brand", brandId: firstBrand.brand_id });
  };

  const closePanel = () => {
    if (saving) return;
    setPanel(null);
    setConfirming(null);
  };

  const setField = (key, value) => {
    setForm((f) => ({ ...f, [key]: value }));
    setFormErrors((e) => ({ ...e, [key]: undefined }));
    setConfirming(null);
    setSaveError(null);
  };

  // Check everything, then show what will change before saving.
  const review = () => {
    const errors = {};
    const email = parseLimitInput(form.email, { label: "Emails a month" });
    const sms = parseLimitInput(form.sms, { label: "Texts a month" });
    const push = parseLimitInput(form.push, { label: "App pushes a month", allowBlank: true });
    const week = parseWeekWarningInput(form.week);
    if (email.error) errors.email = email.error;
    if (sms.error) errors.sms = sms.error;
    if (push.error) errors.push = push.error;
    if (week.error) errors.week = week.error;
    let endsAt = null;
    if (panel?.mode === "brand") {
      const choice = until.find((u) => u.id === form.until);
      if (form.until === "date") {
        const picked = endsAtFromDay(form.day);
        if (picked.error) errors.day = picked.error;
        else endsAt = picked.value;
      } else {
        endsAt = choice?.endsAt ?? null;
      }
    }
    if (form.reason.trim().length === 0) errors.reason = "Add a reason. It is saved with your name.";
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const payload = {
      email: email.value,
      sms: sms.value,
      push: push.value,
      weekWarningAt: week.value,
      endsAt,
      reason: form.reason.trim(),
    };
    const limits = `${formatLimit(payload.email).replace(" a month", "")} emails, ${formatLimit(payload.sms).replace(" a month", "")} texts and ${payload.push === null ? "unlimited" : formatLimit(payload.push).replace(" a month", "")} app pushes a month`;
    const summary = panel?.mode === "defaults"
      ? `Every brand without its own limits gets ${limits}, warned after ${payload.weekWarningAt} blasts a week. This applies straight away.`
      : `${panelBrand?.brand_name ?? "This brand"} gets ${limits}, warned after ${payload.weekWarningAt} blasts a week, ${endsAt ? `until ${formatDate(endsAt)} (then back to the default)` : "with no end date"}. This applies straight away.`;
    setConfirming({ kind: "save", payload, summary });
  };

  const reviewClear = () => {
    if (form.reason.trim().length === 0) {
      setFormErrors({ reason: "Add a reason. It is saved with your name." });
      return;
    }
    setConfirming({
      kind: "clear",
      payload: { reason: form.reason.trim() },
      summary: `${panelBrand?.brand_name ?? "This brand"} goes back to the default limits straight away.`,
    });
  };

  const save = async () => {
    if (!confirming || !panel) return;
    setSaving(true);
    setSaveError(null);
    try {
      let result;
      if (confirming.kind === "clear") {
        result = await clearBrandMessagingLimits({ brandId: panel.brandId, reason: confirming.payload.reason });
      } else if (panel.mode === "defaults") {
        result = await setMessagingLimitDefaults(confirming.payload);
      } else {
        result = await setBrandMessagingLimits({ brandId: panel.brandId, ...confirming.payload });
      }
      if (result?.error) throw result.error;
      addToast({
        variant: "success",
        title: confirming.kind === "clear"
          ? "Back to the default limits"
          : panel.mode === "defaults" ? "Default limits saved" : "Limits saved",
        description: "Applies to the next blast. Logged with your name.",
      });
      setPanel(null);
      setConfirming(null);
      await load();
    } catch (err) {
      setSaveError(messagingLimitErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  if (loadError) {
    return <LoadError title="Couldn't load messaging limits" message={loadError} onRetry={() => void load()} />;
  }

  const tiles = [
    { key: "email", icon: Mail, label: "Email · every brand", value: formatLimit(defaults?.email_monthly) },
    { key: "sms", icon: MessageSquare, label: "SMS · every brand", value: formatLimit(defaults?.sms_monthly) },
    { key: "push", icon: Bell, label: "App push · every brand", value: formatLimit(defaults?.push_monthly) },
    { key: "week", icon: AlertTriangle, label: "Host warned after", value: defaults ? `${defaults.week_warning_at} blasts a week` : "" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <SectionCard key={t.key}>
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-1.5 text-xs text-[var(--color-text-tertiary)]">
                <t.icon className="h-3.5 w-3.5" /> {t.label}
              </span>
              {loading || !defaults ? (
                <Skeleton width="120px" height="28px" />
              ) : (
                <span className="text-xl font-bold text-[var(--color-text-primary)] tabular-nums">{t.value}</span>
              )}
              <div>
                <Button variant="secondary" size="sm" disabled={loading || !defaults} onClick={openDefaults}>
                  Change default
                </Button>
              </div>
            </div>
          </SectionCard>
        ))}
      </div>

      <SectionCard
        title="Brands and their limits"
        subtitle={`${monthLabel(data?.month_start)} so far · resets on the 1st (UTC)`}
        action={
          <Button variant="primary" size="sm" disabled={loading || brands.length === 0} onClick={() => openBrand(null)}>
            Raise a brand's limits
          </Button>
        }
        noPadding
      >
        {loading ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton width="100%" height="20px" />
            <Skeleton width="100%" height="20px" />
            <Skeleton width="100%" height="20px" />
          </div>
        ) : brands.length === 0 ? (
          <p className="p-4 text-sm text-[var(--color-text-secondary)]">
            Brands appear here with their email and text usage once they exist.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--color-text-tertiary)]">
                  <th className="px-4 py-2">Brand</th>
                  <th className="px-4 py-2">Email this month</th>
                  <th className="px-4 py-2">SMS this month</th>
                  <th className="px-4 py-2">Limit source</th>
                  <th className="px-4 py-2">Until</th>
                  <th className="px-4 py-2"><span className="sr-only">Change</span></th>
                </tr>
              </thead>
              <tbody>
                {brands.map((b) => (
                  <tr key={b.brand_id} className="border-t border-[var(--gray-200)] align-top">
                    <td className="px-4 py-2 font-medium text-[var(--color-text-primary)]">{b.brand_name}</td>
                    <td className="px-4 py-2"><UsageCell used={b.email_used} limit={b.email_monthly} /></td>
                    <td className="px-4 py-2"><UsageCell used={b.sms_used} limit={b.sms_monthly} /></td>
                    <td className="px-4 py-2">
                      <Badge variant={b.source === "override" ? "brand" : "default"}>{limitSourceLabel(b)}</Badge>
                      {b.source === "override" && b.override?.reason && (
                        <span className="mt-0.5 block text-xs text-[var(--color-text-tertiary)]">{b.override.reason}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-[var(--color-text-secondary)]">
                      {b.source === "override" ? (b.override?.ends_at ? formatDate(b.override.ends_at) : "No end date") : "–"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Button variant="secondary" size="sm" onClick={() => openBrand(b)}>
                        {b.source === "override" ? "Edit" : "Raise"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="border-t border-[var(--gray-200)] px-4 py-3 text-xs text-[var(--color-text-tertiary)]">
          A brand that reaches its limit sees the existing limit message in the business app. Push has no limit unless you set one.
        </p>
      </SectionCard>

      <Drawer
        open={panel !== null}
        onClose={closePanel}
        title={panel?.mode === "defaults" ? "Default limits for every brand" : "Raise a brand's limits"}
      >
        {panel && (
          <div className="flex flex-col gap-4 text-sm">
            {panel.mode === "brand" && (
              <label className="flex flex-col gap-1">
                <span className="font-medium text-[var(--color-text-primary)]">Brand</span>
                <select
                  value={panel.brandId}
                  onChange={(e) => openBrand(brands.find((b) => b.brand_id === e.target.value))}
                  className="h-10 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3"
                >
                  {brands.map((b) => <option key={b.brand_id} value={b.brand_id}>{b.brand_name}</option>)}
                </select>
                {panelBrand && (
                  <span className="text-xs text-[var(--color-text-tertiary)]">
                    {panelBrand.brand_name} sent {Number(panelBrand.email_used).toLocaleString("en-US")} emails and {Number(panelBrand.sms_used).toLocaleString("en-US")} texts so far this month
                    {panelBrand.sms_cost_minor !== null && panelBrand.sms_cost_currency
                      ? `; this month's texts are estimated at ${formatMinor(panelBrand.sms_cost_minor, panelBrand.sms_cost_currency)}, paid by Mingla.`
                      : "."}
                  </span>
                )}
              </label>
            )}
            {panel.mode === "defaults" && (
              <p className="text-[var(--color-text-secondary)]">Brands with their own limits keep them. Changes apply straight away and are logged.</p>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Input label="Emails a month" inputMode="numeric" value={form.email} error={formErrors.email} onChange={(e) => setField("email", e.target.value)} />
              <Input label="Texts (SMS) a month" inputMode="numeric" value={form.sms} error={formErrors.sms} onChange={(e) => setField("sms", e.target.value)} />
              <Input label="App pushes a month" inputMode="numeric" placeholder="No limit" helper="Leave empty for no limit." value={form.push} error={formErrors.push} onChange={(e) => setField("push", e.target.value)} />
              <Input label="Warn the host after this many blasts in a week" inputMode="numeric" value={form.week} error={formErrors.week} onChange={(e) => setField("week", e.target.value)} />
            </div>
            {panel.mode === "brand" && (
              <label className="flex flex-col gap-1">
                <span className="font-medium text-[var(--color-text-primary)]">Until</span>
                <select
                  value={form.until}
                  onChange={(e) => setField("until", e.target.value)}
                  className="h-10 rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3"
                >
                  {until.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                </select>
              </label>
            )}
            {panel.mode === "brand" && form.until === "date" && (
              <Input label="Last day these limits apply (UTC)" type="date" value={form.day} error={formErrors.day} onChange={(e) => setField("day", e.target.value)} />
            )}
            <Input
              label="Reason (saved with your name)"
              placeholder={panel.mode === "brand" ? "e.g. big launch, paid add-on" : "e.g. more room for everyone"}
              value={form.reason}
              error={formErrors.reason}
              onChange={(e) => setField("reason", e.target.value)}
            />
            {panel.mode === "brand" && (
              <AlertCard variant="info" title="Cost">
                Mingla pays for every text a brand sends; email is close to free. Raise SMS with care.
              </AlertCard>
            )}
            {saveError && <AlertCard variant="error">{saveError}</AlertCard>}
            {confirming ? (
              <AlertCard
                variant={confirming.kind === "clear" ? "info" : "warning"}
                title={confirming.kind === "clear" ? "Back to the default limits?" : "Save these limits?"}
                action={
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" size="sm" disabled={saving} onClick={() => setConfirming(null)}>Go back</Button>
                    <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>
                      {confirming.kind === "clear" ? "Use the defaults" : "Save limits"}
                    </Button>
                  </div>
                }
              >
                {confirming.summary}
              </AlertCard>
            ) : (
              <div className="flex flex-wrap gap-2">
                <Button variant="primary" onClick={review}>
                  {panel.mode === "defaults" ? "Save defaults…" : "Save limits…"}
                </Button>
                {panel.mode === "brand" && panelBrand?.override && (
                  <Button variant="secondary" onClick={reviewClear}>Back to default…</Button>
                )}
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  );
}
