import { useState, useEffect, useCallback } from "react";
import { supabase } from "../lib/supabase";
import { SectionCard, StatCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Textarea, Toggle } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Tabs } from "../components/ui/Tabs";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import {
  Mail, Send, Users, Clock, CheckCircle, XCircle,
  AlertTriangle, Eye, User,
} from "lucide-react";

// ─── Constants ──────────────────────────────────────────────────────────────

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-send-email`;

const SUB_TABS = [
  { id: "compose", label: "Compose" },
  { id: "history", label: "History" },
  { id: "preferences", label: "Preferences" },
];

const EMAIL_TEMPLATES = [
  {
    id: "welcome",
    name: "Welcome",
    subject: "Welcome to Mingla!",
    body: "Hi {name},\n\nWelcome to Mingla! We're thrilled to have you on board.\n\nMingla helps you discover amazing experiences around you — from hidden gems to popular spots, all tailored to your preferences.\n\nGet started by setting your preferences and swiping through your first batch of cards.\n\nHappy exploring!\nThe Mingla Team",
  },
  {
    id: "announcement",
    name: "Feature Announcement",
    subject: "Something New on Mingla",
    body: "Hi {name},\n\nWe've been working on something exciting and it's finally here.\n\n[Describe the feature here]\n\nOpen the app to try it out!\n\nCheers,\nThe Mingla Team",
  },
  {
    id: "maintenance",
    name: "Scheduled Maintenance",
    subject: "Mingla — Scheduled Maintenance",
    body: "Hi {name},\n\nWe'll be performing scheduled maintenance on [DATE] from [TIME] to [TIME] (UTC).\n\nDuring this time, the app may be temporarily unavailable. We'll be back up and running as quickly as possible.\n\nThank you for your patience.\nThe Mingla Team",
  },
  {
    id: "reengagement",
    name: "We Miss You",
    subject: "It's been a while — new experiences await!",
    body: "Hi {name},\n\nWe noticed you haven't opened Mingla in a while. No pressure — but we've added a lot of new places and experiences since your last visit.\n\nCome back and see what's new. Your next great experience might be one swipe away.\n\nSee you soon,\nThe Mingla Team",
  },
];

const SEGMENT_TYPES = [
  { id: "all", label: "All Users" },
  { id: "country", label: "By Country" },
  { id: "onboarding", label: "By Onboarding" },
  { id: "status", label: "By Status" },
];

const PAGE_SIZE = 20;

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatRelativeTime(dateStr) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now - d;
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatFullDate(dateStr) {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-US", {
    month: "long", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function segmentLabel(seg) {
  if (!seg || seg.type === "all") return "All Users";
  if (seg.type === "country") return `Country: ${seg.country || "—"}`;
  if (seg.type === "onboarding") return `Onboarding: ${seg.onboarding || "—"}`;
  if (seg.type === "status") return `Status: ${seg.status || "—"}`;
  return "Custom";
}

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${session.access_token}`,
  };
}

async function callEdgeFunction(payload) {
  const headers = await getAuthHeaders();
  const response = await fetch(EDGE_FUNCTION_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error(`Server error (HTTP ${response.status})`);
  }
  if (!response.ok) {
    if (result.code === "NO_PROVIDER") return { _noProvider: true };
    throw new Error(result.error || `HTTP ${response.status}`);
  }
  return result;
}

// ─── Main Page ──────────────────────────────────────────────────────────────

export function EmailPage() {
  const [activeSubTab, setActiveSubTab] = useState("compose");
  const [providerConfigured, setProviderConfigured] = useState(true);
  const [providerChecked, setProviderChecked] = useState(false);

  // Check provider once per page mount (not per sub-tab switch)
  useEffect(() => {
    let cancelled = false;
    async function checkProvider() {
      try {
        const result = await callEdgeFunction({ action: "estimate", segment: { type: "all" } });
        if (!cancelled) {
          if (result._noProvider) setProviderConfigured(false);
          setProviderChecked(true);
        }
      } catch {
        if (!cancelled) {
          setProviderConfigured(false);
          setProviderChecked(true);
        }
      }
    }
    checkProvider();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-6">
      <Tabs tabs={SUB_TABS} activeTab={activeSubTab} onChange={setActiveSubTab} />
      {activeSubTab === "compose" && (
        <ComposeSubView providerConfigured={providerConfigured} providerChecked={providerChecked} />
      )}
      {activeSubTab === "history" && <HistorySubView />}
      {activeSubTab === "preferences" && <PreferencesSubView />}
    </div>
  );
}

// ─── Compose ────────────────────────────────────────────────────────────────

function ComposeSubView({ providerConfigured, providerChecked }) {
  const { addToast } = useToast();
  const [mode, setMode] = useState("individual");
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fromName, setFromName] = useState("Mingla");
  const [fromEmail, setFromEmail] = useState("hello@usemingla.com");
  const [segment, setSegment] = useState({ type: "all", country: "", onboarding: "", status: "" });
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");

  // Auto-estimate when segment changes in bulk mode
  const handleEstimate = useCallback(async (seg) => {
    setEstimating(true);
    setEstimate(null);
    try {
      const result = await callEdgeFunction({ action: "estimate", segment: seg });
      if (!result._noProvider) setEstimate(result);
    } catch {
      // Silently fail — estimate is informational
    } finally {
      setEstimating(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "bulk") {
      // Debounce estimate calls for country text input
      const timer = setTimeout(() => {
        const seg = { type: segment.type };
        if (segment.type === "country" && segment.country) seg.country = segment.country;
        if (segment.type === "onboarding" && segment.onboarding) seg.onboarding = segment.onboarding;
        if (segment.type === "status" && segment.status) seg.status = segment.status;
        // Don't estimate if a required sub-field is empty
        if (segment.type === "country" && !segment.country) { setEstimate(null); setEstimating(false); return; }
        if (segment.type === "onboarding" && !segment.onboarding) { setEstimate(null); setEstimating(false); return; }
        if (segment.type === "status" && !segment.status) { setEstimate(null); setEstimating(false); return; }
        handleEstimate(seg);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [mode, segment.type, segment.country, segment.onboarding, segment.status, handleEstimate]);

  async function handleSend() {
    // Validation
    if (!subject.trim()) {
      addToast({ variant: "error", title: "Subject is required" });
      return;
    }
    if (!body.trim()) {
      addToast({ variant: "error", title: "Body is required" });
      return;
    }
    if (mode === "individual" && !toEmail.trim()) {
      addToast({ variant: "error", title: "Recipient email is required" });
      return;
    }
    if (mode === "individual" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail.trim())) {
      addToast({ variant: "error", title: "Invalid email address" });
      return;
    }

    const recipientDesc = mode === "individual"
      ? toEmail
      : `${estimate?.will_receive ?? "unknown number of"} users`;

    if (!window.confirm(`Send email to ${recipientDesc}?`)) return;

    setSending(true);
    try {
      const seg = { type: segment.type };
      if (segment.type === "country") seg.country = segment.country;
      if (segment.type === "onboarding") seg.onboarding = segment.onboarding;
      if (segment.type === "status") seg.status = segment.status;

      // Capture estimate before async work to avoid stale state
      const estimatedRecipients = estimate?.will_receive || 0;

      const payload = mode === "individual"
        ? { action: "send", to: toEmail.trim(), subject, body, fromName, fromEmail }
        : { action: "send_bulk", segment: seg, subject, body, fromName, fromEmail };

      const result = await callEdgeFunction(payload);

      // Log to admin_email_log — check for errors
      const { data: { session } } = await supabase.auth.getSession();
      const { error: logError } = await supabase.from("admin_email_log").insert({
        subject,
        body,
        from_name: fromName,
        from_email: fromEmail,
        recipient_type: mode,
        recipient_email: mode === "individual" ? toEmail.trim() : null,
        segment_filter: mode === "bulk" ? seg : null,
        recipient_count: mode === "individual" ? 1 : estimatedRecipients,
        sent_count: result.sent || 0,
        failed_count: result.failed || 0,
        status: (result.failed || 0) === 0 ? "sent" : (result.sent || 0) > 0 ? "partial" : "failed",
        template_used: selectedTemplate || null,
        sent_by: session?.user?.id,
      });

      if (logError) {
        console.error("Failed to log email:", logError);
        addToast({ variant: "warning", title: "Email sent but log failed", description: logError.message });
      }

      if (result.failed > 0) {
        addToast({
          variant: "warning",
          title: `Sent ${result.sent}, failed ${result.failed}`,
          description: result.errors?.length ? result.errors.slice(0, 3).join("; ") : undefined,
        });
      } else {
        addToast({
          variant: "success",
          title: `Email sent to ${result.sent} recipient${result.sent !== 1 ? "s" : ""}`,
        });
      }

      // Reset form
      setSubject("");
      setBody("");
      setToEmail("");
      setSelectedTemplate("");
    } catch (err) {
      addToast({ variant: "error", title: "Failed to send email", description: err.message });
    } finally {
      setSending(false);
    }
  }

  // Not yet checked
  if (!providerChecked) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="md" />
      </div>
    );
  }

  // Provider not configured — show setup instructions
  if (!providerConfigured) {
    return (
      <SectionCard title="Email Setup Required">
        <div className="space-y-4">
          <p className="text-sm text-[var(--color-text-secondary)]">
            Email sending requires configuring Resend as your email provider and deploying the Edge Function.
          </p>
          <div className="space-y-3 text-sm text-[var(--color-text-primary)]">
            <p><strong>Step 1:</strong> Sign up at <code className="px-1.5 py-0.5 rounded text-xs bg-[var(--gray-100)]">resend.com</code> (free — 100 emails/day)</p>
            <p><strong>Step 2:</strong> Create an API key in the Resend dashboard</p>
            <p>
              <strong>Step 3:</strong> Add the key to Supabase secrets:{" "}
              <code className="ml-1 px-2 py-1 rounded text-xs bg-[var(--gray-100)]">
                supabase secrets set RESEND_API_KEY=re_xxxxxxxx
              </code>
            </p>
            <p><strong>Step 4:</strong> Verify your sending domain (<code className="px-1.5 py-0.5 rounded text-xs bg-[var(--gray-100)]">usemingla.com</code>) in Resend, or use <code className="px-1.5 py-0.5 rounded text-xs bg-[var(--gray-100)]">onboarding@resend.dev</code> for testing</p>
            <p>
              <strong>Step 5:</strong> Deploy the Edge Function:{" "}
              <code className="ml-1 px-2 py-1 rounded text-xs bg-[var(--gray-100)]">
                supabase functions deploy admin-send-email
              </code>
            </p>
            <p><strong>Step 6:</strong> Refresh this page</p>
          </div>
        </div>
      </SectionCard>
    );
  }

  return (
    <div className="space-y-5">
      {/* Templates */}
      <SectionCard title="Templates" subtitle="Start from a template or compose from scratch">
        <div className="flex flex-wrap gap-2">
          {EMAIL_TEMPLATES.map((t) => (
            <Button
              key={t.id}
              variant={selectedTemplate === t.id ? "primary" : "ghost"}
              size="sm"
              onClick={() => {
                setSelectedTemplate(t.id);
                setSubject(t.subject);
                setBody(t.body);
              }}
            >
              {t.name}
            </Button>
          ))}
          <Button
            variant={selectedTemplate === "" ? "primary" : "ghost"}
            size="sm"
            onClick={() => { setSelectedTemplate(""); setSubject(""); setBody(""); }}
          >
            Blank
          </Button>
        </div>
      </SectionCard>

      {/* Compose Form */}
      <SectionCard title="Compose Email" subtitle={mode === "individual" ? "Send to one user" : "Send to a segment"}>
        <div className="space-y-5">
          {/* Mode Selector */}
          <div className="flex gap-2">
            <Button
              variant={mode === "individual" ? "primary" : "secondary"}
              size="sm"
              icon={User}
              onClick={() => setMode("individual")}
            >
              Individual
            </Button>
            <Button
              variant={mode === "bulk" ? "primary" : "secondary"}
              size="sm"
              icon={Users}
              onClick={() => setMode("bulk")}
            >
              Bulk
            </Button>
          </div>

          {/* Individual: To field */}
          {mode === "individual" && (
            <Input
              label="To"
              type="email"
              placeholder="user@example.com"
              value={toEmail}
              onChange={(e) => setToEmail(e.target.value)}
            />
          )}

          {/* Bulk: Segment selector */}
          {mode === "bulk" && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-[var(--color-text-primary)]">
                Segment
              </label>
              <div className="flex flex-wrap gap-2">
                {SEGMENT_TYPES.map((s) => (
                  <Button
                    key={s.id}
                    variant={segment.type === s.id ? "primary" : "ghost"}
                    size="sm"
                    onClick={() => setSegment({ ...segment, type: s.id })}
                  >
                    {s.label}
                  </Button>
                ))}
              </div>

              {segment.type === "country" && (
                <Input
                  label="Country"
                  placeholder="e.g. Nigeria"
                  value={segment.country}
                  onChange={(e) => setSegment({ ...segment, country: e.target.value })}
                />
              )}

              {segment.type === "onboarding" && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    Onboarding Status
                  </label>
                  <div className="flex gap-2">
                    <Button
                      variant={segment.onboarding === "completed" ? "primary" : "ghost"}
                      size="sm"
                      onClick={() => setSegment({ ...segment, onboarding: "completed" })}
                    >
                      Completed
                    </Button>
                    <Button
                      variant={segment.onboarding === "incomplete" ? "primary" : "ghost"}
                      size="sm"
                      onClick={() => setSegment({ ...segment, onboarding: "incomplete" })}
                    >
                      Incomplete
                    </Button>
                  </div>
                </div>
              )}

              {segment.type === "status" && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">
                    User Status
                  </label>
                  <div className="flex gap-2">
                    <Button
                      variant={segment.status === "active" ? "primary" : "ghost"}
                      size="sm"
                      onClick={() => setSegment({ ...segment, status: "active" })}
                    >
                      Active
                    </Button>
                    <Button
                      variant={segment.status === "banned" ? "primary" : "ghost"}
                      size="sm"
                      onClick={() => setSegment({ ...segment, status: "banned" })}
                    >
                      Banned
                    </Button>
                  </div>
                </div>
              )}

              {/* Estimate */}
              <div className="text-sm text-[var(--color-text-secondary)]">
                {estimating ? (
                  <span className="flex items-center gap-2">
                    <Spinner size="xs" /> Estimating recipients...
                  </span>
                ) : estimate ? (
                  <span>
                    <strong className="text-[var(--color-text-primary)]">{estimate.will_receive}</strong> will receive
                    {estimate.opted_out > 0 && (
                      <> · <span className="text-[var(--color-warning-700)]">{estimate.opted_out} opted out</span></>
                    )}
                    {" "}· {estimate.total} total
                  </span>
                ) : segment.type !== "all" ? (
                  <span className="text-[var(--color-text-tertiary)]">Select segment options to see estimate</span>
                ) : null}
              </div>

              {/* Rate limit warning */}
              {estimate && estimate.will_receive > 100 && (
                <AlertCard variant="warning" title="Rate Limit Warning">
                  Resend free tier allows 100 emails/day. {estimate.will_receive} recipients exceeds this limit — some emails may fail.
                </AlertCard>
              )}
            </div>
          )}

          {/* From fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="From Name"
              value={fromName}
              onChange={(e) => setFromName(e.target.value)}
            />
            <Input
              label="From Email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              helper={
                fromEmail && !fromEmail.endsWith("@usemingla.com") && !fromEmail.endsWith("@resend.dev")
                  ? "Only @usemingla.com and @resend.dev domains are verified in Resend"
                  : undefined
              }
            />
          </div>

          {/* Subject */}
          <Input
            label="Subject"
            placeholder="Email subject line"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />

          {/* Body */}
          <Textarea
            label="Body"
            placeholder="Write your email content here..."
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="!min-h-[200px]"
          />
          <p className="text-xs text-[var(--color-text-tertiary)] -mt-3">
            Use <code className="px-1 py-0.5 rounded bg-[var(--gray-100)] text-[var(--color-text-secondary)]">{"{ name }"}</code> to insert the recipient's display name.
            {mode === "individual" && " For individual sends, name is replaced server-side based on the recipient's profile."}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <Button
              variant="secondary"
              icon={Eye}
              onClick={() => setShowPreview(true)}
              disabled={!subject.trim() || !body.trim()}
            >
              Preview
            </Button>
            <Button
              variant="primary"
              icon={Send}
              loading={sending}
              onClick={handleSend}
            >
              {sending ? "Sending..." : "Send Email"}
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* Preview Modal */}
      <Modal
        open={showPreview}
        onClose={() => setShowPreview(false)}
        title="Email Preview"
        size="md"
      >
        <ModalBody>
          <div
            className="rounded-lg p-6"
            style={{ background: "#ffffff", color: "#333", fontFamily: "system-ui, sans-serif" }}
          >
            <div style={{ borderBottom: "1px solid #eee", paddingBottom: 12, marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: "#888", margin: 0 }}>
                From: {fromName} &lt;{fromEmail}&gt;
              </p>
              <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>
                To: {mode === "individual" ? (toEmail || "—") : `${estimate?.will_receive ?? "?"} recipients`}
              </p>
              <p style={{ fontSize: 16, fontWeight: 600, marginTop: 12, color: "#111" }}>
                {subject || "(No subject)"}
              </p>
            </div>
            <div>
              {(body || "(No body)").split("\n").map((line, i) => (
                <p key={i} style={{ margin: "0 0 8px 0", minHeight: line.trim() === "" ? 16 : "auto", color: "#333" }}>
                  {line.replace(/\{name\}/g, mode === "individual" ? "User" : "[Recipient Name]")}
                </p>
              ))}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="ghost" onClick={() => setShowPreview(false)}>Close</Button>
          <Button
            variant="primary"
            icon={Send}
            onClick={() => { setShowPreview(false); handleSend(); }}
          >
            Send Now
          </Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ─── History ────────────────────────────────────────────────────────────────

function HistorySubView() {
  const [history, setHistory] = useState([]);
  const [historyCount, setHistoryCount] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [detailLog, setDetailLog] = useState(null);

  // Aggregate stats
  const [stats, setStats] = useState({ totalSent: 0, todayCount: 0, failureRate: 0 });

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const { data, count } = await supabase
        .from("admin_email_log")
        .select("*", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      setHistory(data || []);
      setHistoryCount(count || 0);
    } catch {
      // Table may not exist yet — show empty
      setHistory([]);
      setHistoryCount(0);
    } finally {
      setLoading(false);
    }
  }, [page]);

  const fetchStats = useCallback(async () => {
    try {
      // Fetch only sent_count and failed_count with a safety cap (no full table scan)
      const { data: allTimeLogs } = await supabase
        .from("admin_email_log")
        .select("sent_count, failed_count")
        .limit(10000);

      let totalSent = 0;
      let totalFailed = 0;
      for (const log of (allTimeLogs || [])) {
        totalSent += log.sent_count || 0;
        totalFailed += log.failed_count || 0;
      }

      // Today's emails: fetch only today's logs, sum sent_count (not log count)
      const todayISO = new Date().toISOString().split("T")[0];
      const { data: todayLogs } = await supabase
        .from("admin_email_log")
        .select("sent_count")
        .gte("created_at", todayISO);

      let todayCount = 0;
      for (const log of (todayLogs || [])) {
        todayCount += log.sent_count || 0;
      }

      const totalAttempted = totalSent + totalFailed;
      const failureRate = totalAttempted > 0 ? ((totalFailed / totalAttempted) * 100).toFixed(1) : 0;

      setStats({ totalSent, todayCount, failureRate });
    } catch {
      // Table may not exist
    }
  }, []);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  const columns = [
    {
      key: "subject",
      label: "Subject",
      render: (val) => (
        <span className="font-medium" title={val}>
          {val && val.length > 50 ? val.slice(0, 50) + "..." : val || "—"}
        </span>
      ),
    },
    {
      key: "recipient_type",
      label: "Type",
      render: (val) => (
        <Badge variant={val === "bulk" ? "info" : "default"}>
          {val === "bulk" ? "Bulk" : "Individual"}
        </Badge>
      ),
    },
    {
      key: "sent_count",
      label: "Recipients",
      render: (val, row) => `${val || 0} / ${row.recipient_count || 0}`,
    },
    {
      key: "status",
      label: "Status",
      render: (val) => {
        const v = val === "sent" ? "success" : val === "partial" ? "warning" : "error";
        return <Badge variant={v} dot>{val}</Badge>;
      },
    },
    {
      key: "template_used",
      label: "Template",
      render: (val) => val || "Custom",
    },
    {
      key: "created_at",
      label: "Sent",
      render: (val) => formatRelativeTime(val),
    },
    {
      key: "_actions",
      label: "",
      render: (_, row) => (
        <Button variant="ghost" size="sm" onClick={() => setDetailLog(row)}>
          View
        </Button>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard icon={Send} label="Total Emails Sent" value={stats.totalSent.toLocaleString()} />
        <StatCard icon={Clock} label="Emails Today" value={stats.todayCount} />
        <StatCard
          icon={stats.failureRate > 5 ? AlertTriangle : CheckCircle}
          label="Failure Rate"
          value={`${stats.failureRate}%`}
        />
      </div>

      {/* History Table */}
      <DataTable
        columns={columns}
        rows={history}
        loading={loading}
        emptyIcon={Mail}
        emptyMessage="No emails sent yet"
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: historyCount,
          from: historyCount === 0 ? 0 : page * PAGE_SIZE + 1,
          to: Math.min((page + 1) * PAGE_SIZE, historyCount),
          onChange: setPage,
        }}
      />

      {/* Detail Modal */}
      <Modal
        open={!!detailLog}
        onClose={() => setDetailLog(null)}
        title="Email Log Detail"
        size="lg"
      >
        {detailLog && (
          <>
            <ModalBody>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-[var(--color-text-tertiary)]">Subject</p>
                    <p className="font-medium text-[var(--color-text-primary)]">{detailLog.subject}</p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-tertiary)]">From</p>
                    <p className="text-[var(--color-text-primary)]">{detailLog.from_name} &lt;{detailLog.from_email}&gt;</p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-tertiary)]">Type</p>
                    <p className="text-[var(--color-text-primary)]">
                      {detailLog.recipient_type === "bulk" ? "Bulk" : "Individual"}
                      {detailLog.recipient_email && ` — ${detailLog.recipient_email}`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-tertiary)]">Recipients</p>
                    <p className="text-[var(--color-text-primary)]">
                      {detailLog.recipient_count} targeted, {detailLog.sent_count} sent, {detailLog.failed_count} failed
                    </p>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-tertiary)]">Status</p>
                    <Badge
                      variant={detailLog.status === "sent" ? "success" : detailLog.status === "partial" ? "warning" : "error"}
                      dot
                    >
                      {detailLog.status}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-[var(--color-text-tertiary)]">Sent</p>
                    <p className="text-[var(--color-text-primary)]">{formatFullDate(detailLog.created_at)}</p>
                  </div>
                  {detailLog.template_used && (
                    <div>
                      <p className="text-[var(--color-text-tertiary)]">Template</p>
                      <p className="text-[var(--color-text-primary)]">{detailLog.template_used}</p>
                    </div>
                  )}
                  {detailLog.recipient_type === "bulk" && detailLog.segment_filter && (
                    <div>
                      <p className="text-[var(--color-text-tertiary)]">Segment</p>
                      <p className="text-[var(--color-text-primary)]">{segmentLabel(detailLog.segment_filter)}</p>
                    </div>
                  )}
                </div>

                <div>
                  <p className="text-[var(--color-text-tertiary)] text-sm mb-2">Body</p>
                  <div className="p-4 rounded-lg bg-[var(--gray-50)] border border-[var(--gray-200)] text-sm text-[var(--color-text-primary)] whitespace-pre-wrap font-mono">
                    {detailLog.body}
                  </div>
                </div>
              </div>
            </ModalBody>
            <ModalFooter>
              <Button variant="ghost" onClick={() => setDetailLog(null)}>Close</Button>
            </ModalFooter>
          </>
        )}
      </Modal>
    </div>
  );
}

// ─── Preferences ────────────────────────────────────────────────────────────

const PREFS_PAGE_SIZE = 50;

function PreferencesSubView() {
  const [prefs, setPrefs] = useState([]);
  const [allPrefs, setAllPrefs] = useState([]);
  const [search, setSearch] = useState("");
  const [filterOptedOut, setFilterOptedOut] = useState(false);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);
  const [optedOutCount, setOptedOutCount] = useState(0);
  const [page, setPage] = useState(0);
  const [prefsCount, setPrefsCount] = useState(0);

  const fetchPrefs = useCallback(async () => {
    setLoading(true);
    try {
      let query = supabase
        .from("notification_preferences")
        .select("*, user:profiles!notification_preferences_user_id_fkey(display_name, email)", { count: "exact" })
        .order("updated_at", { ascending: false })
        .range(page * PREFS_PAGE_SIZE, (page + 1) * PREFS_PAGE_SIZE - 1);

      if (filterOptedOut) query = query.eq("email_enabled", false);

      const { data, count } = await query;
      setAllPrefs(data || []);
      setPrefsCount(count || 0);
    } catch {
      setAllPrefs([]);
      setPrefsCount(0);
    } finally {
      setLoading(false);
    }
  }, [filterOptedOut, page]);

  useEffect(() => { fetchPrefs(); }, [fetchPrefs]);
  // Reset page when filter changes
  useEffect(() => { setPage(0); }, [filterOptedOut]);

  // Compute stats from all prefs (not filtered)
  useEffect(() => {
    async function fetchCounts() {
      try {
        const { count: total } = await supabase
          .from("notification_preferences")
          .select("*", { count: "exact", head: true });
        const { count: optedOut } = await supabase
          .from("notification_preferences")
          .select("*", { count: "exact", head: true })
          .eq("email_enabled", false);
        setTotalCount(total || 0);
        setOptedOutCount(optedOut || 0);
      } catch {
        // Table may not exist or RLS blocks
      }
    }
    fetchCounts();
  }, []);

  // Client-side search filter
  useEffect(() => {
    if (!search.trim()) {
      setPrefs(allPrefs);
      return;
    }
    const s = search.toLowerCase();
    setPrefs(
      allPrefs.filter((p) =>
        p.user?.display_name?.toLowerCase().includes(s) ||
        p.user?.email?.toLowerCase().includes(s)
      )
    );
  }, [search, allPrefs]);

  function boolBadge(val) {
    return val === true
      ? <Badge variant="success">On</Badge>
      : val === false
        ? <Badge variant="error">Off</Badge>
        : <Badge variant="default">—</Badge>;
  }

  const columns = [
    {
      key: "user",
      label: "User",
      render: (val) => (
        <div>
          <p className="font-medium text-[var(--color-text-primary)]">{val?.display_name || "Unknown"}</p>
          <p className="text-xs text-[var(--color-text-tertiary)]">{val?.email || "—"}</p>
        </div>
      ),
    },
    { key: "email_enabled", label: "Email", render: boolBadge },
    { key: "push_enabled", label: "Push", render: boolBadge },
    { key: "friend_notifications", label: "Friends", render: boolBadge },
    { key: "message_notifications", label: "Messages", render: boolBadge },
    { key: "collab_notifications", label: "Collabs", render: boolBadge },
    { key: "marketing_enabled", label: "Marketing", render: boolBadge },
    {
      key: "updated_at",
      label: "Last Updated",
      render: (val) => formatRelativeTime(val),
    },
  ];

  return (
    <div className="space-y-5">
      {/* Stats bar */}
      <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)]">
        <span>
          Total users with preferences: <strong className="text-[var(--color-text-primary)]">{totalCount}</strong>
        </span>
        <span>·</span>
        <span>
          Email opted out: <strong className="text-[var(--color-warning-700)]">{optedOutCount}</strong>
          {totalCount > 0 && <> ({((optedOutCount / totalCount) * 100).toFixed(0)}%)</>}
        </span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder="Search by name or email..."
          className="flex-1 max-w-md"
        />
        <Toggle
          label="Show only opted-out"
          checked={filterOptedOut}
          onChange={setFilterOptedOut}
        />
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        rows={prefs}
        loading={loading}
        emptyIcon={Users}
        emptyMessage={search ? "No matching users found" : "No notification preferences found"}
        striped
        pagination={!search ? {
          page,
          pageSize: PREFS_PAGE_SIZE,
          total: prefsCount,
          from: prefsCount === 0 ? 0 : page * PREFS_PAGE_SIZE + 1,
          to: Math.min((page + 1) * PREFS_PAGE_SIZE, prefsCount),
          onChange: setPage,
        } : undefined}
      />
    </div>
  );
}
