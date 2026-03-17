import { useState, useEffect, useMemo } from "react";
import { supabase } from "../lib/supabase";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import { StatCard, SectionCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import {
  TrendingUp, Users, Activity, Target, Globe, Calendar, BarChart3,
  AlertCircle,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────

const SUB_TABS = [
  { id: "growth", label: "User Growth", icon: TrendingUp },
  { id: "engagement", label: "Engagement", icon: Activity },
  { id: "retention", label: "Retention", icon: Calendar },
  { id: "funnel", label: "Funnel", icon: Target },
  { id: "geo", label: "Geographic", icon: Globe },
];

const TIME_RANGES = [
  { id: "7d", label: "7 Days", days: 7 },
  { id: "30d", label: "30 Days", days: 30 },
  { id: "60d", label: "60 Days", days: 60 },
  { id: "90d", label: "90 Days", days: 90 },
];

const CHART_COLORS = {
  primary: "#f97316",
  teal: "#4ECDC4",
  yellow: "#FFD93D",
  red: "#FF6B6B",
  orange: "#FF8C42",
  green: "#A8E6CF",
};

const CHART_THEME = {
  textColor: "var(--color-text-tertiary)",
  gridColor: "var(--gray-200)",
  tooltipBg: "var(--color-background-primary)",
  tooltipBorder: "var(--gray-200)",
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

function getDaysFromRange(timeRange) {
  return TIME_RANGES.find(t => t.id === timeRange)?.days || 30;
}

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
      <p className="text-sm text-[var(--color-text-tertiary)]">{message}</p>
    </div>
  );
}

// ─── User Growth Sub-View ────────────────────────────────────────────────────

function GrowthSubView({ timeRange }) {
  const [signups, setSignups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  const days = getDaysFromRange(timeRange);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const since = new Date(Date.now() - days * DAY_MS).toISOString();
        const { data, error: queryError } = await supabase
          .from("profiles")
          .select("created_at")
          .gte("created_at", since)
          .order("created_at", { ascending: true })
          .limit(50000);

        if (queryError) throw queryError;
        if (!mounted) return;

        const byDay = buildDayBuckets(days);
        (data || []).forEach(row => {
          const key = dateKey(row.created_at);
          if (key in byDay) byDay[key]++;
        });

        setSignups(
          Object.entries(byDay).map(([date, count]) => ({
            date,
            label: formatShortDate(date),
            signups: count,
          }))
        );
      } catch (err) {
        console.error("[Analytics:Growth]", err?.message || err);
        if (mounted) setError("Failed to load signup data");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    return () => { mounted = false; };
  }, [days, retryCount]);

  const totalSignups = useMemo(() => signups.reduce((sum, d) => sum + d.signups, 0), [signups]);
  const avgPerDay = useMemo(() => days > 0 ? (totalSignups / days).toFixed(1) : "0", [totalSignups, days]);
  const peakDay = useMemo(() => {
    if (!signups.length) return "—";
    const peak = signups.reduce((max, d) => d.signups > max.signups ? d : max, signups[0]);
    return peak.signups > 0 ? peak.label : "—";
  }, [signups]);

  if (error) return <ErrorState message={error} onRetry={() => { setError(null); setRetryCount(c => c + 1); }} />;
  if (loading) return <LoadingState />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Users} label="Total Signups" value={totalSignups.toLocaleString()} trend={`Last ${days}d`} />
        <StatCard icon={TrendingUp} label="Avg / Day" value={avgPerDay} />
        <StatCard icon={Calendar} label="Peak Day" value={peakDay} />
      </div>

      <SectionCard title="Daily Signups">
        {totalSignups === 0 ? (
          <EmptyChart message={`No signups in the last ${days} days`} />
        ) : (
          <div style={{ height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={signups}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
                  interval="preserveStartEnd"
                  tickLine={false}
                  axisLine={{ stroke: "var(--gray-200)" }}
                />
                <YAxis
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Line
                  type="monotone"
                  dataKey="signups"
                  stroke={CHART_COLORS.primary}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: CHART_COLORS.primary }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

// ─── Engagement Sub-View ─────────────────────────────────────────────────────

function EngagementSubView({ timeRange }) {
  const [dau, setDau] = useState(0);
  const [wau, setWau] = useState(0);
  const [mau, setMau] = useState(0);
  const [avgSessionMin, setAvgSessionMin] = useState("0");
  const [dailyActive, setDailyActive] = useState([]);
  const [featureUsage, setFeatureUsage] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  const days = getDaysFromRange(timeRange);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
        const weekAgo = new Date(Date.now() - 7 * DAY_MS).toISOString();
        const monthAgo = new Date(Date.now() - 30 * DAY_MS).toISOString();
        const rangeStart = new Date(Date.now() - days * DAY_MS).toISOString();

        // Run all queries in parallel with explicit limits
        const results = await Promise.all([
          supabase.from("user_sessions").select("user_id").gte("started_at", todayStart).limit(50000),
          supabase.from("user_sessions").select("user_id").gte("started_at", weekAgo).limit(50000),
          supabase.from("user_sessions").select("user_id").gte("started_at", monthAgo).limit(50000),
          supabase.from("user_sessions").select("started_at, ended_at").not("ended_at", "is", null).gte("started_at", rangeStart).limit(500),
          supabase.from("user_sessions").select("user_id, started_at").gte("started_at", rangeStart).limit(50000),
          supabase.from("user_interactions").select("interaction_type").gte("created_at", rangeStart).limit(10000),
        ]);

        // Check for query errors before processing
        const firstError = results.find(r => r.error)?.error;
        if (firstError) throw firstError;

        if (!mounted) return;

        const [todayResult, weekResult, monthResult, completedResult, rangeResult, interactionResult] = results;

        // DAU / WAU / MAU
        setDau(new Set((todayResult.data || []).map(s => s.user_id)).size);
        setWau(new Set((weekResult.data || []).map(s => s.user_id)).size);
        setMau(new Set((monthResult.data || []).map(s => s.user_id)).size);

        // Average session duration
        const completed = completedResult.data || [];
        if (completed.length > 0) {
          const totalMin = completed.reduce((sum, s) => {
            const dur = (new Date(s.ended_at) - new Date(s.started_at)) / 60000;
            return sum + Math.max(0, Math.min(dur, 120)); // clamp 0–120 min
          }, 0);
          setAvgSessionMin((totalMin / completed.length).toFixed(1));
        } else {
          setAvgSessionMin("0");
        }

        // Daily active users trend
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
          Object.entries(byDay).map(([date, users]) => ({
            date,
            label: formatShortDate(date),
            dau: users.size,
          }))
        );

        // Feature usage
        const typeCounts = {};
        (interactionResult.data || []).forEach(i => {
          const t = i.interaction_type || "unknown";
          typeCounts[t] = (typeCounts[t] || 0) + 1;
        });
        setFeatureUsage(
          Object.entries(typeCounts)
            .map(([type, count]) => ({ type, count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
        );
      } catch (err) {
        console.error("[Analytics:Engagement]", err?.message || err);
        if (mounted) setError("Failed to load engagement data");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    return () => { mounted = false; };
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

      <SectionCard title="Daily Active Users">
        {dailyActive.every(d => d.dau === 0) ? (
          <EmptyChart message={`No sessions in the last ${days} days`} />
        ) : (
          <div style={{ height: 400 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyActive}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" />
                <XAxis
                  dataKey="label"
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
                  interval="preserveStartEnd"
                  tickLine={false}
                  axisLine={{ stroke: "var(--gray-200)" }}
                />
                <YAxis
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip contentStyle={TOOLTIP_STYLE} />
                <Line
                  type="monotone"
                  dataKey="dau"
                  stroke={CHART_COLORS.teal}
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: CHART_COLORS.teal }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Feature Usage" subtitle="Top interaction types">
        {featureUsage.length === 0 ? (
          <EmptyChart message={`No interactions in the last ${days} days`} />
        ) : (
          <div style={{ height: Math.max(200, featureUsage.length * 40 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={featureUsage} layout="vertical" margin={{ left: 20, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  dataKey="type"
                  type="category"
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={120}
                />
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

// ─── Retention Sub-View ──────────────────────────────────────────────────────

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

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const eightWeeksAgo = new Date(Date.now() - 56 * DAY_MS).toISOString();

        const { data: profiles, error: profileErr } = await supabase
          .from("profiles")
          .select("id, created_at")
          .gte("created_at", eightWeeksAgo)
          .limit(50000);

        if (profileErr) throw profileErr;
        if (!mounted) return;

        const userIds = (profiles || []).map(p => p.id);

        if (userIds.length === 0) {
          setCohortData([]);
          setLoading(false);
          return;
        }

        // Batch user IDs for the IN query — run batches in parallel
        const batchSize = 200;
        const batchPromises = [];
        for (let i = 0; i < userIds.length; i += batchSize) {
          const batch = userIds.slice(i, i + batchSize);
          batchPromises.push(
            supabase
              .from("user_sessions")
              .select("user_id, started_at")
              .in("user_id", batch)
              .gte("started_at", eightWeeksAgo)
              .limit(50000)
          );
        }
        const batchResults = await Promise.all(batchPromises);

        if (!mounted) return;

        // Check for errors in any batch
        const batchError = batchResults.find(r => r.error)?.error;
        if (batchError) throw batchError;

        const allSessions = [];
        batchResults.forEach(({ data }) => {
          if (data) allSessions.push(...data);
        });

        const eightWeeksAgoMs = new Date(eightWeeksAgo).getTime();

        const getWeekNumber = (dateStr) => {
          const d = new Date(dateStr);
          return Math.floor((d.getTime() - eightWeeksAgoMs) / (7 * DAY_MS));
        };

        // Group profiles into weekly cohorts
        const cohorts = {};
        (profiles || []).forEach(p => {
          const week = getWeekNumber(p.created_at);
          if (week < 0 || week > 7) return;
          if (!cohorts[week]) cohorts[week] = { users: new Set(), weekLabel: "" };
          cohorts[week].users.add(p.id);
          const weekStart = new Date(eightWeeksAgoMs + week * 7 * DAY_MS);
          cohorts[week].weekLabel = weekStart.toLocaleDateString("en", { month: "short", day: "numeric" });
        });

        // Build session lookup: user_id + week → true
        const sessionsByUserWeek = {};
        allSessions.forEach(s => {
          const week = getWeekNumber(s.started_at);
          if (week < 0 || week > 7) return;
          sessionsByUserWeek[`${s.user_id}-${week}`] = true;
        });

        // Calculate retention
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
              row.retention.push(
                users.size > 0 ? Math.round((activeCount / users.size) * 100) : 0
              );
            }
            return row;
          });

        setCohortData(result);
      } catch (err) {
        console.error("[Analytics:Retention]", err?.message || err);
        if (mounted) setError("Failed to load retention data");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    return () => { mounted = false; };
  }, [retryCount]);

  if (error) return <ErrorState message={error} onRetry={() => { setError(null); setRetryCount(c => c + 1); }} />;
  if (loading) return <LoadingState />;

  if (cohortData.length === 0) {
    return (
      <SectionCard title="Weekly Cohort Retention">
        <EmptyChart message="No signup cohorts in the last 8 weeks" />
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
                <th key={i} className="text-center py-2 px-3 text-xs font-semibold text-[var(--color-text-secondary)]">
                  Wk {i}
                </th>
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
                  if (pct === undefined) {
                    return <td key={i} className="py-2 px-3" />;
                  }
                  return (
                    <td
                      key={i}
                      className="py-2 px-3 text-center font-medium text-[var(--color-text-primary)]"
                      style={{ backgroundColor: getRetentionColor(pct) }}
                    >
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

// ─── Funnel Sub-View ─────────────────────────────────────────────────────────

function FunnelSubView() {
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const results = await Promise.all([
          supabase.from("profiles").select("*", { count: "exact", head: true }),
          supabase.from("profiles").select("*", { count: "exact", head: true }).eq("has_completed_onboarding", true),
          supabase.from("user_interactions").select("user_id").limit(50000),
          supabase.from("session_participants").select("user_id").limit(50000),
        ]);

        // Check for query errors before processing
        const firstError = results.find(r => r.error)?.error;
        if (firstError) throw firstError;

        if (!mounted) return;

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
        if (mounted) setError("Failed to load funnel data");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    return () => { mounted = false; };
  }, [retryCount]);

  if (error) return <ErrorState message={error} onRetry={() => { setError(null); setRetryCount(c => c + 1); }} />;
  if (loading) return <LoadingState />;

  if (stages.length === 0 || stages[0].count === 0) {
    return (
      <SectionCard title="Conversion Funnel">
        <EmptyChart message="No users yet — funnel will populate as users sign up" />
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Conversion Funnel" subtitle="Signup → Onboarding → Interaction → Board">
      <div className="space-y-3 py-2">
        {stages.map((stage, i) => (
          <div key={stage.label} className="flex items-center gap-4">
            <div className="w-44 text-right text-sm text-[var(--color-text-secondary)] shrink-0">
              {stage.label}
            </div>
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

// ─── Geographic Sub-View ─────────────────────────────────────────────────────

function GeoSubView() {
  const [countryData, setCountryData] = useState([]);
  const [noCountryCount, setNoCountryCount] = useState(0);
  const [totalCountries, setTotalCountries] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        const { data, error: queryError } = await supabase
          .from("profiles")
          .select("country")
          .limit(50000);

        if (queryError) throw queryError;
        if (!mounted) return;

        const rows = data || [];
        let nullCount = 0;
        const counts = {};

        rows.forEach(p => {
          if (!p.country) {
            nullCount++;
          } else {
            counts[p.country] = (counts[p.country] || 0) + 1;
          }
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
        if (mounted) setError("Failed to load geographic data");
      } finally {
        if (mounted) setLoading(false);
      }
    }

    fetchData();
    return () => { mounted = false; };
  }, [retryCount]);

  if (error) return <ErrorState message={error} onRetry={() => { setError(null); setRetryCount(c => c + 1); }} />;
  if (loading) return <LoadingState />;

  const topCountry = countryData.length > 0 ? countryData[0].country : "—";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Globe} label="Countries" value={totalCountries.toLocaleString()} />
        <StatCard icon={Target} label="Top Country" value={topCountry} />
        <StatCard icon={Users} label="No Country Set" value={noCountryCount.toLocaleString()} />
      </div>

      <SectionCard title="Users by Country" subtitle="Top 20">
        {countryData.length === 0 ? (
          <EmptyChart message="No country data available — users may not have set their country yet" />
        ) : (
          <div style={{ height: Math.max(200, countryData.length * 36 + 40) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={countryData} layout="vertical" margin={{ left: 20, right: 20, top: 5, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--gray-200)" horizontal={false} />
                <XAxis
                  type="number"
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  dataKey="country"
                  type="category"
                  tick={{ fill: "var(--color-text-tertiary)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={120}
                />
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

  // Retention and Funnel don't use time range, hide the toggle for them
  const showTimeRange = activeSubTab === "growth" || activeSubTab === "engagement";

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
          <div className="flex gap-2">
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
          </div>
        )}
      </div>

      {/* Active sub-view */}
      {activeSubTab === "growth" && <GrowthSubView timeRange={timeRange} />}
      {activeSubTab === "engagement" && <EngagementSubView timeRange={timeRange} />}
      {activeSubTab === "retention" && <RetentionSubView />}
      {activeSubTab === "funnel" && <FunnelSubView />}
      {activeSubTab === "geo" && <GeoSubView />}
    </div>
  );
}
