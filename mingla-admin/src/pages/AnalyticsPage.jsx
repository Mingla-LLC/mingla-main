import { useState, useEffect, useMemo, useRef } from "react";
import { supabase } from "../lib/supabase";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { StatCard, SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Spinner } from "../components/ui/Spinner";
import {
  TrendingUp, Users, Activity, Target, Globe, Calendar, BarChart3,
  AlertCircle, AlertTriangle, RefreshCw, Download, Map,
} from "lucide-react";
import { useToast } from "../context/ToastContext";
import { timeAgo, formatDate, formatDateTime, truncate, escapeLike } from "../lib/formatters";
import { logAdminAction } from "../lib/auditLog";
import { exportCsv } from "../lib/exportCsv";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUB_TABS = [
  { id: "growth", label: "Growth", icon: TrendingUp },
  { id: "engagement", label: "Engagement", icon: Activity },
  { id: "retention", label: "Retention", icon: Calendar },
  { id: "funnel", label: "Funnel", icon: Target },
  { id: "geo", label: "Geography", icon: Globe },
];

const TIME_RANGES = [
  { id: "7d", label: "7 Days", days: 7 },
  { id: "30d", label: "30 Days", days: 30 },
  { id: "60d", label: "60 Days", days: 60 },
  { id: "90d", label: "90 Days", days: 90 },
  { id: "custom", label: "Custom", days: null },
];

const CHART_COLORS = {
  primary: "#f97316",
  teal: "#4ECDC4",
  yellow: "#FFD93D",
  red: "#FF6B6B",
  orange: "#FF8C42",
  green: "#A8E6CF",
};

const TOOLTIP_STYLE = {
  backgroundColor: "var(--color-background-primary)",
  border: "1px solid var(--gray-200)",
  borderRadius: 8,
  color: "var(--color-text-primary)",
  fontFamily: "'Geist Mono', monospace",
  fontSize: 12,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function formatShortDate(dateStr) {
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en", { month: "short", day: "numeric" });
}

function dateKey(isoString) {
  return isoString.split("T")[0];
}

function buildDayBuckets(days) {
  const buckets = {};
  const start = new Date(Date.now() - days * DAY_MS);
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    buckets[d.toISOString().split("T")[0]] = 0;
  }
  return buckets;
}

function getDaysFromRange(timeRange) {
  return TIME_RANGES.find(t => t.id === timeRange)?.days || 30;
}

// ─── Shared UI ───────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <Spinner size="lg" />
    </div>
  );
}

function ErrorState({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[300px] gap-3">
      <AlertCircle className="w-8 h-8 text-[var(--color-text-tertiary)]" />
      <p className="text-sm text-[var(--color-text-secondary)]">{message}</p>
      {onRetry && <Button variant="secondary" size="sm" onClick={onRetry}>Retry</Button>}
    </div>
  );
}

function EmptyChart({ message }) {
  return (
    <div className="flex items-center justify-center min-h-[300px]">
      <p className="text-sm text-[var(--color-text-tertiary)]">{message || "No data for this period."}</p>
    </div>
  );
}

function SetupScreen({ message }) {
  return (
    <SectionCard>
      <div className="flex flex-col items-center justify-center py-12 gap-4">
        <AlertTriangle className="w-10 h-10 text-[var(--color-warning-600)]" />
        <p className="text-sm text-[var(--color-text-secondary)] text-center max-w-md">{message}</p>
        <p className="text-xs text-[var(--color-text-tertiary)]">Run the analytics RPC migrations to enable this tab.</p>
      </div>
    </SectionCard>
  );
}

// ─── User Growth Sub-View (RPC-based) ────────────────────────────────────────

function GrowthSubView({ days, addToast }) {
  const [signups, setSignups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [setupNeeded, setSetupNeeded] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        // Try RPC first
        const { data: rpcData, error: rpcError } = await supabase.rpc("admin_analytics_growth", { p_days: days });
        if (rpcError) {
          if (rpcError.code === "PGRST202") {
            // Fallback to client-side
            const since = new Date(Date.now() - days * DAY_MS).toISOString();
            const { data, error: queryError } = await supabase
              .from("profiles")
              .select("created_at")
              .gte("created_at", since)
              .order("created_at", { ascending: true })
              .limit(50000);
            if (queryError) throw queryError;
            if (cancelled) return;

            const byDay = buildDayBuckets(days);
            (data || []).forEach(row => {
              const key = dateKey(row.created_at);
              if (key in byDay) byDay[key]++;
            });
            setSignups(
              Object.entries(byDay).map(([date, count]) => ({
                date, label: formatShortDate(date), signups: count,
              }))
            );
          } else {
            throw rpcError;
          }
        } else {
          if (cancelled) return;
          setSignups(
            (rpcData || []).map(row => ({
              date: row.day, label: formatShortDate(row.day), signups: row.signups,
            }))
          );
        }
      } catch (err) {
        console.error("[Analytics:Growth]", err?.message || err);
        if (!cancelled && mountedRef.current) setError("Failed to load signup data");
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [days, retryCount]);

  const totalSignups = useMemo(() => signups.reduce((sum, d) => sum + d.signups, 0), [signups]);
  const avgPerDay = useMemo(() => days > 0 ? (totalSignups / days).toFixed(1) : "0", [totalSignups, days]);
  const peakDay = useMemo(() => {
    if (!signups.length) return "—";
    const peak = signups.reduce((max, d) => d.signups > max.signups ? d : max, signups[0]);
    return peak.signups > 0 ? peak.label : "—";
  }, [signups]);

  const handleExport = () => {
    const cols = [
      { key: "date", label: "Date" },
      { key: "signups", label: "Signups" },
    ];
    const { exported } = exportCsv(cols, signups, "growth");
    if (addToast) addToast({ variant: "success", title: `Exported ${exported} rows` });
  };

  if (setupNeeded) return <SetupScreen message="Growth analytics RPC not found." />;
  if (error) return <ErrorState message={error} onRetry={() => { setError(null); setRetryCount(c => c + 1); }} />;
  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Users} label="Total Signups" value={totalSignups.toLocaleString()} trend={`Last ${days}d`} />
        <StatCard icon={TrendingUp} label="Avg / Day" value={avgPerDay} />
        <StatCard icon={Calendar} label="Peak Day" value={peakDay} />
      </div>

      <SectionCard title="Daily Signups" action={
        <Button variant="ghost" size="sm" icon={Download} onClick={handleExport}>Export</Button>
      }>
        {totalSignups === 0 ? (
          <EmptyChart message={`No signups in the last ${days} days`} />
        ) : (
          <div style={{ height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={signups}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
                <XAxis dataKey="label" tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }} interval="preserveStartEnd" tickLine={false} axisLine={{ stroke: "var(--gray-200)" }} />
                <YAxis tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Line type="monotone" dataKey="signups" stroke={CHART_COLORS.primary} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: CHART_COLORS.primary }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Engagement Sub-View (RPC-based) ─────────────────────────────────────────

function EngagementSubView({ days }) {
  const [dau, setDau] = useState(0);
  const [wau, setWau] = useState(0);
  const [mau, setMau] = useState(0);
  const [avgSessionMin, setAvgSessionMin] = useState("0");
  const [dailyActive, setDailyActive] = useState([]);
  const [featureUsage, setFeatureUsage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        // Try RPC
        const { data: rpcData, error: rpcError } = await supabase.rpc("admin_analytics_engagement", { p_days: days });

        if (rpcError && rpcError.code !== "PGRST202") throw rpcError;

        if (!rpcError && rpcData) {
          if (cancelled) return;
          const d = Array.isArray(rpcData) ? rpcData[0] : rpcData;
          setDau(d?.dau ?? 0);
          setWau(d?.wau ?? 0);
          setMau(d?.mau ?? 0);
          setAvgSessionMin(d?.avg_duration_seconds ? (d.avg_duration_seconds / 60).toFixed(1) : "0");
          setFeatureUsage(
            (d?.feature_usage || []).map(f => ({ type: f.type || f.interaction_type, count: f.count })).sort((a, b) => b.count - a.count).slice(0, 10)
          );
          // No daily active from RPC — leave empty
          setDailyActive([]);
          setLoading(false);
          return;
        }

        // Fallback: client-side (same as before)
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const weekAgo = new Date(Date.now() - 7 * DAY_MS).toISOString();
        const monthAgo = new Date(Date.now() - 30 * DAY_MS).toISOString();
        const rangeStart = new Date(Date.now() - days * DAY_MS).toISOString();

        const results = await Promise.all([
          supabase.from("user_sessions").select("user_id").gte("started_at", todayStart).limit(50000),
          supabase.from("user_sessions").select("user_id").gte("started_at", weekAgo).limit(50000),
          supabase.from("user_sessions").select("user_id").gte("started_at", monthAgo).limit(50000),
          supabase.from("user_sessions").select("started_at, ended_at").not("ended_at", "is", null).gte("started_at", rangeStart).limit(500),
          supabase.from("user_sessions").select("user_id, started_at").gte("started_at", rangeStart).limit(50000),
          supabase.from("user_interactions").select("interaction_type").gte("created_at", rangeStart).limit(10000),
        ]);

        const firstError = results.find(r => r.error)?.error;
        if (firstError) throw firstError;
        if (cancelled) return;

        const [todayResult, weekResult, monthResult, completedResult, rangeResult, interactionResult] = results;

        setDau(new Set((todayResult.data || []).map(s => s.user_id)).size);
        setWau(new Set((weekResult.data || []).map(s => s.user_id)).size);
        setMau(new Set((monthResult.data || []).map(s => s.user_id)).size);

        const completed = completedResult.data || [];
        if (completed.length > 0) {
          const totalMin = completed.reduce((sum, s) => {
            const dur = (new Date(s.ended_at) - new Date(s.started_at)) / 60000;
            return sum + Math.max(0, Math.min(dur, 120));
          }, 0);
          setAvgSessionMin((totalMin / completed.length).toFixed(1));
        } else {
          setAvgSessionMin("0");
        }

        const byDay = {};
        const startDate = new Date(Date.now() - days * DAY_MS);
        for (let i = 0; i < days; i++) {
          const d = new Date(startDate.getTime() + i * DAY_MS);
          byDay[d.toISOString().split("T")[0]] = new Set();
        }
        (rangeResult.data || []).forEach(s => {
          const key = dateKey(s.started_at);
          if (byDay[key]) byDay[key].add(s.user_id);
        });
        setDailyActive(
          Object.entries(byDay).map(([date, users]) => ({ date, label: formatShortDate(date), dau: users.size }))
        );

        const typeCounts = {};
        (interactionResult.data || []).forEach(i => {
          const t = i.interaction_type || "unknown";
          typeCounts[t] = (typeCounts[t] || 0) + 1;
        });
        setFeatureUsage(
          Object.entries(typeCounts).map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count).slice(0, 10)
        );
      } catch (err) {
        console.error("[Analytics:Engagement]", err?.message || err);
        if (!cancelled && mountedRef.current) setError("Failed to load engagement data");
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [days, retryCount]);

  if (error) return <ErrorState message={error} onRetry={() => { setError(null); setRetryCount(c => c + 1); }} />;
  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={Users} label="DAU" value={dau.toLocaleString()} trend="Today" />
        <StatCard icon={Activity} label="WAU" value={wau.toLocaleString()} trend="7 days" />
        <StatCard icon={BarChart3} label="MAU" value={mau.toLocaleString()} trend="30 days" />
        <StatCard icon={Calendar} label="Avg Session" value={`${avgSessionMin} min`} />
      </div>

      {dailyActive.length > 0 && (
        <SectionCard title="Daily Active Users">
          {dailyActive.every(d => d.dau === 0) ? (
            <EmptyChart message="No data for this period." />
          ) : (
            <div style={{ height: 400 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={dailyActive}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
                  <XAxis dataKey="label" tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }} interval="preserveStartEnd" tickLine={false} axisLine={{ stroke: "var(--gray-200)" }} />
                  <YAxis tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Line type="monotone" dataKey="dau" stroke={CHART_COLORS.teal} strokeWidth={2} dot={false} activeDot={{ r: 4, fill: CHART_COLORS.teal }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </SectionCard>
      )}

      <SectionCard title="Feature Usage" subtitle="Top interaction types">
        {featureUsage.length === 0 ? (
          <EmptyChart message="No data for this period." />
        ) : (
          <div style={{ height: Math.max(200, featureUsage.length * 40 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={featureUsage} layout="vertical" margin={{ left: 20, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis dataKey="type" type="category" tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }} tickLine={false} axisLine={false} width={120} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Retention Sub-View (RPC-based) ──────────────────────────────────────────

function getRetentionColor(pct) {
  if (pct >= 70) return "rgba(168, 230, 207, 0.3)";
  if (pct >= 40) return "rgba(255, 217, 61, 0.2)";
  if (pct >= 20) return "rgba(255, 140, 66, 0.2)";
  return "rgba(255, 107, 107, 0.2)";
}

function RetentionSubView() {
  const [cohortData, setCohortData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        // Try RPC
        const { data: rpcData, error: rpcError } = await supabase.rpc("admin_analytics_retention", { p_weeks: 8 });

        if (rpcError && rpcError.code !== "PGRST202") throw rpcError;

        if (!rpcError && rpcData && rpcData.length > 0) {
          if (cancelled) return;
          setCohortData(rpcData);
          setLoading(false);
          return;
        }

        // Fallback: client-side
        const eightWeeksAgo = new Date(Date.now() - 56 * DAY_MS).toISOString();
        const eightWeeksAgoMs = new Date(eightWeeksAgo).getTime();

        const { data: profiles, error: profileErr } = await supabase
          .from("profiles")
          .select("id, created_at")
          .gte("created_at", eightWeeksAgo)
          .limit(50000);

        if (profileErr) throw profileErr;
        if (cancelled) return;

        const userIds = (profiles || []).map(p => p.id);
        if (userIds.length === 0) { setCohortData([]); setLoading(false); return; }

        const batchSize = 200;
        const batchPromises = [];
        for (let i = 0; i < userIds.length; i += batchSize) {
          const batch = userIds.slice(i, i + batchSize);
          batchPromises.push(
            supabase.from("user_sessions").select("user_id, started_at").in("user_id", batch).gte("started_at", eightWeeksAgo).limit(50000)
          );
        }
        const batchResults = await Promise.all(batchPromises);
        if (cancelled) return;

        const batchError = batchResults.find(r => r.error)?.error;
        if (batchError) throw batchError;

        const allSessions = [];
        batchResults.forEach(({ data }) => { if (data) allSessions.push(...data); });

        const getWeekNumber = (dateStr) => Math.floor((new Date(dateStr).getTime() - eightWeeksAgoMs) / (7 * DAY_MS));

        const cohorts = {};
        (profiles || []).forEach(p => {
          const week = getWeekNumber(p.created_at);
          if (week < 0 || week > 7) return;
          if (!cohorts[week]) cohorts[week] = { users: new Set(), weekLabel: "" };
          cohorts[week].users.add(p.id);
          const weekStart = new Date(eightWeeksAgoMs + week * 7 * DAY_MS);
          cohorts[week].weekLabel = weekStart.toLocaleDateString("en", { month: "short", day: "numeric" });
        });

        const sessionsByUserWeek = {};
        allSessions.forEach(s => {
          const week = getWeekNumber(s.started_at);
          if (week < 0 || week > 7) return;
          sessionsByUserWeek[`${s.user_id}-${week}`] = true;
        });

        const result = Object.entries(cohorts)
          .sort(([a], [b]) => Number(a) - Number(b))
          .map(([cohortWeek, { users, weekLabel }]) => {
            const row = { weekLabel, cohortSize: users.size, retention: [] };
            const maxWeeks = Math.min(8, 8 - Number(cohortWeek));
            for (let w = 0; w < maxWeeks; w++) {
              const targetWeek = Number(cohortWeek) + w;
              let activeCount = 0;
              users.forEach(uid => {
                if (sessionsByUserWeek[`${uid}-${targetWeek}`]) activeCount++;
              });
              row.retention.push(users.size > 0 ? Math.round((activeCount / users.size) * 100) : 0);
            }
            return row;
          });

        setCohortData(result);
      } catch (err) {
        console.error("[Analytics:Retention]", err?.message || err);
        if (!cancelled && mountedRef.current) setError("Failed to load retention data");
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [retryCount]);

  if (error) return <ErrorState message={error} onRetry={() => { setError(null); setRetryCount(c => c + 1); }} />;
  if (loading) return <LoadingState />;

  if (cohortData.length === 0) {
    return (
      <SectionCard title="Weekly Cohort Retention">
        <EmptyChart message="No data for this period." />
      </SectionCard>
    );
  }

  const maxRetentionCols = Math.max(...cohortData.map(c => c.retention.length));

  return (
    <SectionCard title="Weekly Cohort Retention" subtitle="% of users active in each subsequent week">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--gray-200)]">
              <th className="text-left py-2 px-3 text-xs font-semibold text-[var(--color-text-secondary)]">Cohort</th>
              <th className="text-center py-2 px-3 text-xs font-semibold text-[var(--color-text-secondary)]">Size</th>
              {Array.from({ length: maxRetentionCols }, (_, i) => (
                <th key={i} className="text-center py-2 px-3 text-xs font-semibold text-[var(--color-text-secondary)]">Wk {i}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cohortData.map((row) => (
              <tr key={row.weekLabel} className="border-b border-[var(--gray-200)] last:border-0">
                <td className="py-2 px-3 text-[var(--color-text-primary)] font-medium whitespace-nowrap">{row.weekLabel}</td>
                <td className="py-2 px-3 text-center text-[var(--color-text-secondary)]">{row.cohortSize}</td>
                {Array.from({ length: maxRetentionCols }, (_, i) => {
                  const pct = row.retention[i];
                  if (pct === undefined) return <td key={i} className="py-2 px-3" />;
                  return (
                    <td key={i} className="py-2 px-3 text-center font-medium text-[var(--color-text-primary)]" style={{ backgroundColor: getRetentionColor(pct) }}>
                      {pct}%
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </SectionCard>
  );
}

// ─── Funnel Sub-View (RPC-based) ─────────────────────────────────────────────

function FunnelSubView() {
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        // Try RPC
        const { data: rpcData, error: rpcError } = await supabase.rpc("admin_analytics_funnel");

        if (rpcError && rpcError.code !== "PGRST202") throw rpcError;

        if (!rpcError && rpcData) {
          if (cancelled) return;
          const d = Array.isArray(rpcData) ? rpcData[0] : rpcData;
          if (d) {
            const total = d.signups ?? 0;
            const safePct = (n) => total > 0 ? Math.round((n / total) * 100) : 0;
            setStages([
              { label: "Signed Up", count: total, pct: 100 },
              { label: "Completed Onboarding", count: d.onboarded ?? 0, pct: safePct(d.onboarded ?? 0) },
              { label: "First Interaction", count: d.interacted ?? 0, pct: safePct(d.interacted ?? 0) },
              { label: "Joined a Board", count: d.boarded ?? 0, pct: safePct(d.boarded ?? 0) },
            ]);
            setLoading(false);
            return;
          }
        }

        // Fallback: client-side
        const results = await Promise.all([
          supabase.from("profiles").select("*", { count: "exact", head: true }),
          supabase.from("profiles").select("*", { count: "exact", head: true }).eq("has_completed_onboarding", true),
          supabase.from("user_interactions").select("user_id").limit(50000),
          supabase.from("session_participants").select("user_id").limit(50000),
        ]);

        const firstError = results.find(r => r.error)?.error;
        if (firstError) throw firstError;
        if (cancelled) return;

        const [totalResult, onboardedResult, interactorsResult, boardJoinersResult] = results;
        const totalUsers = totalResult.count ?? 0;
        const onboarded = onboardedResult.count ?? 0;
        const uniqueInteractors = new Set((interactorsResult.data || []).map(i => i.user_id)).size;
        const uniqueBoardJoiners = new Set((boardJoinersResult.data || []).map(j => j.user_id)).size;

        const safePct = (n) => totalUsers > 0 ? Math.round((n / totalUsers) * 100) : 0;

        setStages([
          { label: "Signed Up", count: totalUsers, pct: 100 },
          { label: "Completed Onboarding", count: onboarded, pct: safePct(onboarded) },
          { label: "First Interaction", count: uniqueInteractors, pct: safePct(uniqueInteractors) },
          { label: "Joined a Board", count: uniqueBoardJoiners, pct: safePct(uniqueBoardJoiners) },
        ]);
      } catch (err) {
        console.error("[Analytics:Funnel]", err?.message || err);
        if (!cancelled && mountedRef.current) setError("Failed to load funnel data");
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [retryCount]);

  if (error) return <ErrorState message={error} onRetry={() => { setError(null); setRetryCount(c => c + 1); }} />;
  if (loading) return <LoadingState />;

  if (stages.length === 0 || stages[0].count === 0) {
    return (
      <SectionCard title="Conversion Funnel">
        <EmptyChart message="No data for this period." />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Conversion Funnel" subtitle="Signup → Onboarding → Interaction → Board">
      <div className="space-y-3 py-2">
        {stages.map((stage, i) => (
          <div key={stage.label} className="flex items-center gap-4">
            <div className="w-44 text-right text-sm text-[var(--color-text-secondary)] shrink-0">{stage.label}</div>
            <div className="flex-1 relative" style={{ height: 40 }}>
              <div
                style={{
                  width: `${Math.max(stage.pct, 8)}%`,
                  height: "100%",
                  backgroundColor: CHART_COLORS.primary,
                  opacity: 1 - (i * 0.15),
                  borderRadius: 6,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 12,
                  transition: "width 0.3s ease-out",
                }}
              >
                <span style={{ color: "#fff", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
                  {stage.count.toLocaleString()} ({stage.pct}%)
                </span>
              </div>
            </div>
            {i > 0 && (
              <div className="w-24 text-xs text-[var(--color-text-tertiary)] shrink-0">
                ↓ {(stages[i - 1].count - stage.count).toLocaleString()} drop
              </div>
            )}
          </div>
        ))}
      </div>
    </SectionCard>
  );
}

// ─── Geographic Sub-View (RPC-based + Leaflet) ───────────────────────────────

// Simple country → lat/lng lookup for map circles (top ~40 countries)
const COUNTRY_COORDS = {
  "US": [39.8, -98.5], "United States": [39.8, -98.5],
  "GB": [55.3, -3.4], "United Kingdom": [55.3, -3.4],
  "CA": [56.1, -106.3], "Canada": [56.1, -106.3],
  "AU": [-25.3, 133.8], "Australia": [-25.3, 133.8],
  "DE": [51.2, 10.5], "Germany": [51.2, 10.5],
  "FR": [46.2, 2.2], "France": [46.2, 2.2],
  "IN": [20.6, 79.0], "India": [20.6, 79.0],
  "BR": [-14.2, -51.9], "Brazil": [-14.2, -51.9],
  "JP": [36.2, 138.3], "Japan": [36.2, 138.3],
  "NG": [9.1, 8.7], "Nigeria": [9.1, 8.7],
  "MX": [23.6, -102.6], "Mexico": [23.6, -102.6],
  "ZA": [-30.6, 22.9], "South Africa": [-30.6, 22.9],
  "KR": [35.9, 127.8], "South Korea": [35.9, 127.8],
  "IT": [41.9, 12.6], "Italy": [41.9, 12.6],
  "ES": [40.5, -3.7], "Spain": [40.5, -3.7],
  "NL": [52.1, 5.3], "Netherlands": [52.1, 5.3],
  "SE": [60.1, 18.6], "Sweden": [60.1, 18.6],
  "NO": [60.5, 8.5], "Norway": [60.5, 8.5],
  "DK": [56.3, 9.5], "Denmark": [56.3, 9.5],
  "FI": [61.9, 25.7], "Finland": [61.9, 25.7],
  "PL": [51.9, 19.1], "Poland": [51.9, 19.1],
  "CH": [46.8, 8.2], "Switzerland": [46.8, 8.2],
  "AT": [47.5, 14.6], "Austria": [47.5, 14.6],
  "BE": [50.5, 4.5], "Belgium": [50.5, 4.5],
  "PT": [39.4, -8.2], "Portugal": [39.4, -8.2],
  "IE": [53.1, -7.7], "Ireland": [53.1, -7.7],
  "IL": [31.0, 34.9], "Israel": [31.0, 34.9],
  "AE": [23.4, 53.8], "United Arab Emirates": [23.4, 53.8],
  "SG": [1.4, 103.8], "Singapore": [1.4, 103.8],
  "PH": [12.9, 121.8], "Philippines": [12.9, 121.8],
  "TH": [15.9, 100.99], "Thailand": [15.9, 100.99],
  "ID": [-0.8, 113.9], "Indonesia": [-0.8, 113.9],
  "CO": [4.6, -74.3], "Colombia": [4.6, -74.3],
  "AR": [-38.4, -63.6], "Argentina": [-38.4, -63.6],
  "CL": [-35.7, -71.5], "Chile": [-35.7, -71.5],
  "EG": [26.8, 30.8], "Egypt": [26.8, 30.8],
  "KE": [-0.02, 37.9], "Kenya": [-0.02, 37.9],
  "GH": [7.9, -1.0], "Ghana": [7.9, -1.0],
};

function GeoSubView({ addToast }) {
  const [countryData, setCountryData] = useState([]);
  const [noCountryCount, setNoCountryCount] = useState(0);
  const [totalCountries, setTotalCountries] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);
  const [showMap, setShowMap] = useState(false);
  const [MapContainer, setMapContainer] = useState(null);
  const [TileLayer, setTileLayer] = useState(null);
  const [CircleMarker, setCircleMarker] = useState(null);
  const [LeafletTooltip, setLeafletTooltip] = useState(null);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // Dynamically import leaflet
  useEffect(() => {
    async function loadLeaflet() {
      try {
        const rl = await import("react-leaflet");
        setMapContainer(() => rl.MapContainer);
        setTileLayer(() => rl.TileLayer);
        setCircleMarker(() => rl.CircleMarker);
        setLeafletTooltip(() => rl.Tooltip);
        // Import leaflet CSS
        await import("leaflet/dist/leaflet.css");
        setShowMap(true);
      } catch {
        // Leaflet not available — skip map
      }
    }
    loadLeaflet();
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        // Try RPC
        const { data: rpcData, error: rpcError } = await supabase.rpc("admin_analytics_geo");

        if (rpcError && rpcError.code !== "PGRST202") throw rpcError;

        if (!rpcError && rpcData && rpcData.length > 0) {
          if (cancelled) return;
          const sorted = rpcData.sort((a, b) => (b.user_count ?? 0) - (a.user_count ?? 0)).slice(0, 20);
          const mapped = sorted.map(r => ({ country: r.country, count: r.user_count }));
          setCountryData(mapped);
          setTotalCountries(rpcData.length);
          setNoCountryCount(0); // RPC doesn't return null countries
          setLoading(false);
          return;
        }

        // Fallback: client-side
        const { data, error: queryError } = await supabase.from("profiles").select("country").limit(50000);
        if (queryError) throw queryError;
        if (cancelled) return;

        const rows = data || [];
        let nullCount = 0;
        const counts = {};
        rows.forEach(p => {
          if (!p.country) { nullCount++; } else { counts[p.country] = (counts[p.country] || 0) + 1; }
        });

        const sorted = Object.entries(counts)
          .map(([country, count]) => ({ country, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 20);

        setCountryData(sorted);
        setNoCountryCount(nullCount);
        setTotalCountries(Object.keys(counts).length);
      } catch (err) {
        console.error("[Analytics:Geo]", err?.message || err);
        if (!cancelled && mountedRef.current) setError("Failed to load geographic data");
      } finally {
        if (!cancelled && mountedRef.current) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [retryCount]);

  const handleExport = () => {
    const cols = [
      { key: "country", label: "Country" },
      { key: "count", label: "Users" },
    ];
    const { exported } = exportCsv(cols, countryData, "geo");
    if (addToast) addToast({ variant: "success", title: `Exported ${exported} rows` });
  };

  if (error) return <ErrorState message={error} onRetry={() => { setError(null); setRetryCount(c => c + 1); }} />;
  if (loading) return <LoadingState />;

  const topCountry = countryData.length > 0 ? countryData[0].country : "—";
  const maxCount = countryData.length > 0 ? countryData[0].count : 1;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Globe} label="Countries" value={totalCountries.toLocaleString()} />
        <StatCard icon={Target} label="Top Country" value={topCountry} />
        <StatCard icon={Users} label="No Country Set" value={noCountryCount.toLocaleString()} />
      </div>

      {/* Leaflet Map */}
      {showMap && MapContainer && countryData.length > 0 && (
        <SectionCard title="User Distribution Map">
          <div style={{ height: 400 }}>
            <MapContainer center={[20, 0]} zoom={2} style={{ height: "100%", width: "100%", borderRadius: 8 }} scrollWheelZoom={false}>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              {countryData.map(({ country, count }) => {
                const coords = COUNTRY_COORDS[country];
                if (!coords) return null;
                const radius = Math.max(6, Math.min(30, (count / maxCount) * 30));
                return (
                  <CircleMarker
                    key={country}
                    center={coords}
                    radius={radius}
                    pathOptions={{ fillColor: CHART_COLORS.primary, fillOpacity: 0.6, color: CHART_COLORS.primary, weight: 1 }}
                  >
                    <LeafletTooltip>{country}: {count} users</LeafletTooltip>
                  </CircleMarker>
                );
              })}
            </MapContainer>
          </div>
        </SectionCard>
      )}

      <SectionCard title="Users by Country" subtitle="Top 20" action={
        <Button variant="ghost" size="sm" icon={Download} onClick={handleExport}>Export</Button>
      }>
        {countryData.length === 0 ? (
          <EmptyChart message="No data for this period." />
        ) : (
          <div style={{ height: Math.max(200, countryData.length * 36 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={countryData} layout="vertical" margin={{ left: 20, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" horizontal={false} />
                <XAxis type="number" tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis dataKey="country" type="category" tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }} tickLine={false} axisLine={false} width={120} />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Bar dataKey="count" fill={CHART_COLORS.teal} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Main Analytics Page ─────────────────────────────────────────────────────

export function AnalyticsPage() {
  const [activeSubTab, setActiveSubTab] = useState("growth");
  const [timeRange, setTimeRange] = useState("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const { addToast } = useToast();

  const showTimeRange = activeSubTab === "growth" || activeSubTab === "engagement";

  // Compute effective days
  const effectiveDays = useMemo(() => {
    if (timeRange === "custom" && customFrom && customTo) {
      const diff = new Date(customTo).getTime() - new Date(customFrom).getTime();
      return Math.max(1, Math.ceil(diff / DAY_MS));
    }
    return getDaysFromRange(timeRange);
  }, [timeRange, customFrom, customTo]);

  return (
    <div className="space-y-6">
      {/* Sub-tab navigation + time range */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex gap-1 bg-[var(--gray-100)] rounded-lg p-1">
          {SUB_TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSubTab(tab.id)}
                className={[
                  "flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md",
                  "transition-all duration-150 cursor-pointer",
                  isActive
                    ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm"
                    : "text-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]",
                ].join(" ")}
              >
                <Icon className="w-4 h-4" />
                <span className="hidden md:inline">{tab.label}</span>
              </button>
            );
          })}
        </div>

        {showTimeRange && (
          <div className="flex gap-2 flex-wrap items-center">
            {TIME_RANGES.map(tr => (
              <Button
                key={tr.id}
                variant={timeRange === tr.id ? "primary" : "ghost"}
                size="sm"
                onClick={() => setTimeRange(tr.id)}
              >
                {tr.label}
              </Button>
            ))}
            {timeRange === "custom" && (
              <div className="flex items-center gap-2 ml-2">
                <input
                  type="date"
                  value={customFrom}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="h-8 px-2 rounded border border-[var(--gray-200)] text-xs bg-[var(--color-background-primary)] text-[var(--color-text-primary)]"
                />
                <span className="text-xs text-[var(--color-text-tertiary)]">to</span>
                <input
                  type="date"
                  value={customTo}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="h-8 px-2 rounded border border-[var(--gray-200)] text-xs bg-[var(--color-background-primary)] text-[var(--color-text-primary)]"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Active sub-view */}
      {activeSubTab === "growth" && <GrowthSubView days={effectiveDays} addToast={addToast} />}
      {activeSubTab === "engagement" && <EngagementSubView days={effectiveDays} />}
      {activeSubTab === "retention" && <RetentionSubView />}
      {activeSubTab === "funnel" && <FunnelSubView />}
      {activeSubTab === "geo" && <GeoSubView addToast={addToast} />}
    </div>
  );
}
