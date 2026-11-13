import { useState, useEffect, useCallback, useRef } from "react";
import {
  supabase,
  SESSION_EXPIRED_MESSAGE,
} from "../lib/supabase";
import { SectionCard, AlertCard } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input, Textarea, Toggle } from "../components/ui/Input";
import { Badge } from "../components/ui/Badge";
import { SearchInput } from "../components/ui/SearchInput";
import { DataTable } from "../components/ui/Table";
import { Modal, ModalBody, ModalFooter } from "../components/ui/Modal";
import { Tabs } from "../components/ui/Tabs";
import { Spinner } from "../components/ui/Spinner";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { formatRelativeTime } from "../lib/formatters";
import { logAdminAction } from "../lib/auditLog";
import {
  Send, Users, Clock, Eye, User, Plus, Pencil, Trash2,
} from "lucide-react";
import { PageHeader } from "../components/ui/PageHeader";
import { EmailComposer } from "../components/email/EmailComposer";
import {
  emailDetailHash,
  emailDetailIdFromHash,
  emailListFilterFromHash,
  emailViewFromHash,
  emailViewHash,
  emailViewsFor,
} from "../lib/emailViews";
import { isFullAdmin } from "../lib/access";
// #4419: one Emails tab (list + a full page per email) replaces Scheduled and Sent.
import { EmailsListView } from "../components/email/campaigns/EmailsListView";
import { EmailDetailPage } from "../components/email/campaigns/EmailDetailPage";
// #4383: the admin-send-email client lives in one place (the Overview uses it too).
import { callEdgeFunction } from "../services/adminSendEmailService";

// ─── Constants ──────────────────────────────────────────────────────────────

// #4419: the screen's sections (Write, Emails, Templates, Unsubscribes) and
// who sees each live in lib/emailViews.js; the open one is `view=` in the
// address, and one email's page is #/email/<id>. #4255: every teammate writes
// and sends (D5); only admins see sent emails and the unsubscribe list.

// #3720 Slice B — only segments the edge actually filters. City / tier /
// last_active were UI-only and silently sent to everyone (bug 4).
const SEGMENT_TYPES = [
  { id: "all", label: "All Users" },
  { id: "country", label: "By Country" },
  { id: "onboarding", label: "By Onboarding" },
  { id: "status", label: "By Status" },
];

const DAILY_EMAIL_LIMIT = 100;

// ─── Main Page ──────────────────────────────────────────────────────────────

// #4383 — Communications › Email, its own screen (#/email). Every teammate
// opens it (lib/access.js PAGE_ADDITIONAL_AREAS.email), exactly as the old
// Support tab.
export function EmailPage() {
  const { signOut, access, session } = useAuth();
  const subTabs = emailViewsFor(access);
  const isAdmin = isFullAdmin(access);
  const readAddress = useCallback((views) => {
    const hash = window.location.hash;
    const detailId = emailDetailIdFromHash(hash);
    return {
      hash,
      view: detailId ? "emails" : emailViewFromHash(hash, views),
      detailId,
      filter: emailListFilterFromHash(hash),
    };
  }, []);
  const [address, setAddress] = useState(() => readAddress(subTabs));
  const activeSubTab = address.view;
  const subTabsKey = subTabs.map((tab) => tab.id).join(",");
  useEffect(() => {
    const views = emailViewsFor(access);
    const sync = () => setAddress(readAddress(views));
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
    // subTabsKey stands for the views this person has.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subTabsKey]);
  const changeView = useCallback((viewId) => {
    window.location.hash = emailViewHash(viewId);
  }, []);
  // #4419: "Duplicate as new" opens Write prefilled with the sent email.
  const [duplicate, setDuplicate] = useState(null);
  const [providerConfigured, setProviderConfigured] = useState(true);
  const [providerChecked, setProviderChecked] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const mountedRef = useRef(true);
  const onSessionExpired = useCallback(() => setSessionExpired(true), []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function checkProvider() {
      try {
        const result = await callEdgeFunction({ action: "check_provider" });
        if (!cancelled) {
          setProviderConfigured(!result._noProvider && result.configured !== false);
          setProviderChecked(true);
          setSessionExpired(false);
        }
      } catch (err) {
        if (!cancelled && err?.name === "SessionExpiredError") {
          setSessionExpired(true);
        }
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
      <PageHeader
        title="Email"
        description="Write, schedule and track emails to hosts, creators and Locals."
        actions={activeSubTab === "write" ? null : (
          <Button icon={Pencil} onClick={() => { setDuplicate(null); changeView("write"); }}>Write email</Button>
        )}
        tabs={<Tabs tabs={subTabs} activeTab={activeSubTab} onChange={(id) => { if (id === "write") setDuplicate(null); changeView(id); }} />}
      />
      {sessionExpired && (
        <div
          role="alert"
          className="rounded-lg border border-[var(--color-warning-300)] bg-[var(--color-warning-50)] px-4 py-3 text-sm text-[var(--color-text-primary)]"
        >
          {SESSION_EXPIRED_MESSAGE}{" "}
          <button
            type="button"
            className="underline font-medium"
            onClick={() => void signOut()}
          >
            Sign in again
          </button>
        </div>
      )}
      {(activeSubTab === "write" || activeSubTab === "templates") && (
        <ComposeSubView
          key={duplicate?.key || "compose"}
          providerConfigured={providerConfigured}
          providerChecked={providerChecked}
          onSessionExpired={onSessionExpired}
          openTemplateManager={activeSubTab === "templates"}
          initialDraft={activeSubTab === "write" ? duplicate : null}
        />
      )}
      {activeSubTab === "emails" && address.detailId && (
        <EmailDetailPage
          key={address.detailId}
          campaignId={address.detailId}
          isAdmin={isAdmin}
          myEmail={session?.user?.email || access?.email || ""}
          providerConfigured={providerConfigured}
          onBack={() => { window.location.hash = emailViewHash("emails"); }}
          onDuplicate={(draft) => { setDuplicate(draft); changeView("write"); }}
          onSessionExpired={onSessionExpired}
        />
      )}
      {activeSubTab === "emails" && !address.detailId && (
        <EmailsListView
          // #4419 (tester P3-1): a new address (#/email?view=scheduled from a
          // link on this page) re-opens the list with its filter. Chip clicks
          // rewrite the address without a hashchange, so they never remount.
          key={address.hash}
          isAdmin={isAdmin}
          initialFilter={address.filter}
          onOpen={(id) => { window.location.hash = emailDetailHash(id); }}
          onWrite={() => changeView("write")}
          onFilterChange={(filter) => window.history.replaceState(null, "", emailViewHash("emails", filter))}
          onSessionExpired={onSessionExpired}
        />
      )}
      {activeSubTab === "unsubscribes" && <PreferencesSubView />}
    </div>
  );
}

// ─── Compose ────────────────────────────────────────────────────────────────

function ComposeSubView(props) {
  return (
    <EmailComposer
      callEdgeFunction={callEdgeFunction}
      providerConfigured={props.providerConfigured}
      onSessionExpired={props.onSessionExpired}
      openTemplateManager={props.openTemplateManager}
      initialDraft={props.initialDraft}
    />
  );
}

function LegacyComposeSubView({ providerConfigured, providerChecked, onSessionExpired }) {
  const { addToast } = useToast();
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const [mode, setMode] = useState("individual");
  const [toEmail, setToEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [fromName, setFromName] = useState("Mingla");
  const [fromEmail, setFromEmail] = useState("hello@usemingla.com");
  // ORCH-0785: brand-shell toggle defaults ON. When ON, the edge function
  // wraps subject+body in the Mingla shared shell (logo + footer). OFF sends
  // raw plain text for operator test pings.
  const [useBrandShell, setUseBrandShell] = useState(true);
  const [segment, setSegment] = useState({ type: "all", country: "", onboarding: "", status: "" });
  const [sending, setSending] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [estimate, setEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState("");

  // DB templates
  const [templates, setTemplates] = useState([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [showManageTemplates, setShowManageTemplates] = useState(false);
  const [editTemplate, setEditTemplate] = useState(null);
  const [templateForm, setTemplateForm] = useState({ name: "", subject: "", body: "" });
  const [templateSaving, setTemplateSaving] = useState(false);
  const [deleteTemplateModal, setDeleteTemplateModal] = useState(null);

  // Rate limit
  const [todaySentCount, setTodaySentCount] = useState(0);
  const remainingToday = Math.max(DAILY_EMAIL_LIMIT - todaySentCount, 0);
  const limitReached = remainingToday <= 0;

  // City options for segment
  // Send confirmation modal
  const [sendConfirmModal, setSendConfirmModal] = useState(false);

  // Fetch templates from DB
  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const { data } = await supabase
        .from("email_templates")
        .select("*")
        .order("name", { ascending: true });
      if (mountedRef.current) setTemplates(data || []);
    } catch {
      // Table may not exist
    } finally {
      if (mountedRef.current) setTemplatesLoading(false);
    }
  }, []);

  // Fetch today's sent count for rate limit
  const fetchTodayCount = useCallback(async () => {
    try {
      const todayISO = new Date().toISOString().split("T")[0];
      const { data } = await supabase
        .from("admin_email_log")
        .select("sent_count")
        .gte("created_at", todayISO);
      let count = 0;
      for (const log of (data || [])) count += log.sent_count || 0;
      if (mountedRef.current) setTodaySentCount(count);
    } catch {
      // Silently fail
    }
  }, []);

  useEffect(() => { fetchTemplates(); }, [fetchTemplates]);
  useEffect(() => { fetchTodayCount(); }, [fetchTodayCount]);

  // Auto-estimate when segment changes in bulk mode
  const handleEstimate = useCallback(async (seg) => {
    setEstimating(true);
    setEstimate(null);
    try {
      const result = await callEdgeFunction({ action: "estimate", segment: seg });
      if (!result._noProvider && mountedRef.current) setEstimate(result);
    } catch {
      // Silently fail
    } finally {
      if (mountedRef.current) setEstimating(false);
    }
  }, []);

  useEffect(() => {
    if (mode === "bulk") {
      const timer = setTimeout(() => {
        const seg = { type: segment.type };
        if (segment.type === "country" && segment.country) seg.country = segment.country;
        if (segment.type === "onboarding" && segment.onboarding) seg.onboarding = segment.onboarding;
        if (segment.type === "status" && segment.status) seg.status = segment.status;

        const needsSubField = ["country", "onboarding", "status"];
        if (needsSubField.includes(segment.type) && !segment[segment.type]) {
          setEstimate(null);
          setEstimating(false);
          return;
        }
        handleEstimate(seg);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [mode, segment, handleEstimate]);

  // ─── Template CRUD ──────────────────────────────────────────────────────

  async function handleSaveTemplate() {
    if (!templateForm.name.trim() || !templateForm.subject.trim()) {
      addToast({ variant: "error", title: "Name and subject are required" });
      return;
    }
    setTemplateSaving(true);
    try {
      if (editTemplate?.id) {
        const { error } = await supabase.from("email_templates")
          .update({ name: templateForm.name, subject: templateForm.subject, body: templateForm.body })
          .eq("id", editTemplate.id);
        if (error) throw error;
        addToast({ variant: "success", title: "Template updated" });
        await logAdminAction("config.update", "email_template", editTemplate.id, { name: templateForm.name });
      } else {
        const { error } = await supabase.from("email_templates")
          .insert({ name: templateForm.name, subject: templateForm.subject, body: templateForm.body });
        if (error) throw error;
        addToast({ variant: "success", title: "Template created" });
        await logAdminAction("config.create", "email_template", null, { name: templateForm.name });
      }
      setEditTemplate(null);
      setTemplateForm({ name: "", subject: "", body: "" });
      fetchTemplates();
    } catch (err) {
      addToast({ variant: "error", title: "Failed to save template", description: err.message });
    } finally {
      setTemplateSaving(false);
    }
  }

  async function handleDeleteTemplate() {
    if (!deleteTemplateModal) return;
    try {
      const { error } = await supabase.from("email_templates").delete().eq("id", deleteTemplateModal.id);
      if (error) throw error;
      addToast({ variant: "success", title: "Template deleted" });
      await logAdminAction("config.delete", "email_template", deleteTemplateModal.id, { name: deleteTemplateModal.name });
      setDeleteTemplateModal(null);
      fetchTemplates();
    } catch (err) {
      addToast({ variant: "error", title: "Delete failed", description: err.message });
    }
  }

  // ─── Send ──────────────────────────────────────────────────────────────

  async function handleSend() {
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
    if (limitReached) {
      addToast({ variant: "error", title: "Daily email limit reached" });
      return;
    }

    setSendConfirmModal(true);
  }

  async function confirmSend() {
    setSendConfirmModal(false);
    setSending(true);
    try {
      const seg = { type: segment.type };
      if (segment.type === "country") seg.country = segment.country;
      if (segment.type === "onboarding") seg.onboarding = segment.onboarding;
      if (segment.type === "status") seg.status = segment.status;

      const payload = mode === "individual"
        ? { action: "send", to: toEmail.trim(), subject, body, fromName, fromEmail, useBrandShell }
        : { action: "send_bulk", segment: seg, subject, body, fromName, fromEmail, useBrandShell };

      const result = await callEdgeFunction(payload);

      // #3720 bug 6 — admin_email_log is written only by admin-send-email (edge).
      // Do not insert a second client row here.

      await logAdminAction("email.send", "email", null, {
        mode,
        recipientCount: result.sent || 0,
        subject,
        segment: mode === "bulk" ? seg : undefined,
      });

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

      setSubject("");
      setBody("");
      setToEmail("");
      setSelectedTemplate("");
      fetchTodayCount();
    } catch (err) {
      if (err?.name === "SessionExpiredError") {
        onSessionExpired?.();
      } else {
        addToast({ variant: "error", title: "Failed to send email", description: err.message });
      }
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }

  if (!providerChecked) {
    return (
      <div className="flex items-center justify-center py-20">
        <Spinner size="md" />
      </div>
    );
  }

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
            <p><strong>Step 4:</strong> Verify your sending domain in Resend (DKIM/SPF/DMARC for <code className="px-1.5 py-0.5 rounded text-xs bg-[var(--gray-100)]">usemingla.com</code> — needed for <code className="px-1.5 py-0.5 rounded text-xs bg-[var(--gray-100)]">tickets@</code>, <code className="px-1.5 py-0.5 rounded text-xs bg-[var(--gray-100)]">hello@</code>, <code className="px-1.5 py-0.5 rounded text-xs bg-[var(--gray-100)]">notifications@</code>). Sandbox senders are blocked by the Mingla shell.</p>
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

  const recipientDesc = mode === "individual"
    ? toEmail
    : `${estimate?.will_receive ?? "unknown number of"} users`;

  return (
    <div className="space-y-5">
      {/* Rate Limit Banner */}
      <div className="flex items-center gap-3 text-sm text-[var(--color-text-secondary)]">
        <Clock className="h-4 w-4" />
        <span>Daily limit: {DAILY_EMAIL_LIMIT} emails. <strong className={limitReached ? "text-[var(--color-error-600)]" : "text-[var(--color-text-primary)]"}>{remainingToday}</strong> remaining today.</span>
      </div>

      {/* Templates */}
      <SectionCard
        title="Templates"
        subtitle="Start from a template or compose from scratch"
        action={
          <Button variant="secondary" size="sm" icon={Pencil} onClick={() => setShowManageTemplates(true)}>
            Manage Templates
          </Button>
        }
      >
        {templatesLoading ? (
          <div className="flex items-center gap-2 text-sm text-[var(--color-text-tertiary)]"><Spinner size="xs" /> Loading templates...</div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {templates.map((t) => (
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
        )}
      </SectionCard>

      {/* Compose Form */}
      <SectionCard title="Compose Email" subtitle={mode === "individual" ? "Send to one user" : "Send to a segment"}>
        <div className="space-y-5">
          {/* Mode Selector */}
          <div className="flex gap-2">
            <Button variant={mode === "individual" ? "primary" : "secondary"} size="sm" icon={User} onClick={() => setMode("individual")}>
              Individual
            </Button>
            <Button variant={mode === "bulk" ? "primary" : "secondary"} size="sm" icon={Users} onClick={() => setMode("bulk")}>
              Bulk
            </Button>
          </div>

          {/* Individual: To field */}
          {mode === "individual" && (
            <Input label="To" type="email" placeholder="user@example.com" value={toEmail} onChange={(e) => setToEmail(e.target.value)} />
          )}

          {/* Bulk: Segment selector */}
          {mode === "bulk" && (
            <div className="space-y-3">
              <label className="block text-sm font-medium text-[var(--color-text-primary)]">Segment</label>
              <div className="flex flex-wrap gap-2">
                {SEGMENT_TYPES.map((s) => (
                  <Button key={s.id} variant={segment.type === s.id ? "primary" : "ghost"} size="sm" onClick={() => setSegment({ ...segment, type: s.id })}>
                    {s.label}
                  </Button>
                ))}
              </div>

              {segment.type === "country" && (
                <Input label="Country" placeholder="e.g. Nigeria" value={segment.country} onChange={(e) => setSegment({ ...segment, country: e.target.value })} />
              )}

              {segment.type === "onboarding" && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">Onboarding Status</label>
                  <div className="flex gap-2">
                    {["completed", "incomplete"].map(v => (
                      <Button key={v} variant={segment.onboarding === v ? "primary" : "ghost"} size="sm" onClick={() => setSegment({ ...segment, onboarding: v })}>
                        {v.charAt(0).toUpperCase() + v.slice(1)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {segment.type === "status" && (
                <div>
                  <label className="block text-sm font-medium text-[var(--color-text-primary)] mb-1.5">User Status</label>
                  <div className="flex gap-2">
                    {["active", "banned"].map(v => (
                      <Button key={v} variant={segment.status === v ? "primary" : "ghost"} size="sm" onClick={() => setSegment({ ...segment, status: v })}>
                        {v.charAt(0).toUpperCase() + v.slice(1)}
                      </Button>
                    ))}
                  </div>
                </div>
              )}

              {/* Estimate */}
              <div className="text-sm text-[var(--color-text-secondary)]">
                {estimating ? (
                  <span className="flex items-center gap-2"><Spinner size="xs" /> Estimating recipients...</span>
                ) : estimate ? (
                  <span>
                    <strong className="text-[var(--color-text-primary)]">{estimate.will_receive}</strong> will receive
                    {estimate.opted_out > 0 && (<> · <span className="text-[var(--color-warning-700)]">{estimate.opted_out} opted out</span></>)}
                    {" "}· {estimate.total} total
                  </span>
                ) : segment.type !== "all" ? (
                  <span className="text-[var(--color-text-tertiary)]">Select segment options to see estimate</span>
                ) : null}
              </div>

              {estimate && estimate.will_receive > DAILY_EMAIL_LIMIT && (
                <AlertCard variant="warning" title="Rate Limit Warning">
                  Resend free tier allows {DAILY_EMAIL_LIMIT} emails/day. {estimate.will_receive} recipients exceeds this limit — some emails may fail.
                </AlertCard>
              )}
            </div>
          )}

          {/* From fields */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input label="From Name" value={fromName} onChange={(e) => setFromName(e.target.value)} />
            <Input
              label="From Email"
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              helper={
                fromEmail && !fromEmail.endsWith("@usemingla.com")
                  ? "Only verified @usemingla.com senders will deliver — Mingla blocks @resend.dev"
                  : undefined
              }
            />
          </div>

          {/* ORCH-0785 brand-shell toggle */}
          <div className="flex items-center justify-between rounded-lg border border-[var(--color-border)] p-3">
            <div>
              <p className="text-sm font-medium text-[var(--color-text-primary)]">Use Mingla brand shell</p>
              <p className="text-xs text-[var(--color-text-tertiary)]">Wraps the email in the Mingla header, footer, and accessible HTML layout. Recommended for all customer-facing sends.</p>
            </div>
            <Toggle checked={useBrandShell} onChange={setUseBrandShell} />
          </div>

          {/* Subject */}
          <Input label="Subject" placeholder="Email subject line" value={subject} onChange={(e) => setSubject(e.target.value)} />

          {/* Body */}
          <Textarea label="Body" placeholder="Write your email content here..." value={body} onChange={(e) => setBody(e.target.value)} className="!min-h-[200px]" />
          <p className="text-xs text-[var(--color-text-tertiary)] -mt-3">
            Available placeholders: {"{name}"}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <Button variant="secondary" icon={Eye} onClick={() => setShowPreview(true)} disabled={!subject.trim() || !body.trim()}>
              Preview
            </Button>
            <Button
              variant="primary"
              icon={Send}
              loading={sending}
              onClick={handleSend}
              disabled={limitReached}
            >
              {sending ? "Sending..." : "Send Email"}
            </Button>
          </div>
        </div>
      </SectionCard>

      {/* Preview Modal */}
      <Modal open={showPreview} onClose={() => setShowPreview(false)} title="Email Preview" size="md">
        <ModalBody>
          {useBrandShell && (
            <div className="mb-3 text-xs text-[var(--color-text-tertiary)] flex items-center gap-2">
              <span className="inline-block px-2 py-0.5 rounded-full bg-[var(--color-brand-500)] text-white font-medium">Mingla brand shell ON</span>
              <span>Final email wraps this content in the Mingla logo header + support footer.</span>
            </div>
          )}
          <div className="rounded-lg p-6" style={{ background: "#ffffff", color: "#333", fontFamily: "system-ui, sans-serif" }}>
            <div style={{ borderBottom: "1px solid #eee", paddingBottom: 12, marginBottom: 16 }}>
              <p style={{ fontSize: 12, color: "#888", margin: 0 }}>From: {fromName} &lt;{fromEmail}&gt;</p>
              <p style={{ fontSize: 12, color: "#888", margin: "4px 0 0" }}>To: {mode === "individual" ? (toEmail || "—") : `${estimate?.will_receive ?? "?"} recipients`}</p>
              <p style={{ fontSize: 16, fontWeight: 600, marginTop: 12, color: "#111" }}>{subject || "(No subject)"}</p>
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
          <Button variant="primary" icon={Send} onClick={() => { setShowPreview(false); handleSend(); }}>Send Now</Button>
        </ModalFooter>
      </Modal>

      {/* Send Confirmation Modal */}
      <Modal open={sendConfirmModal} onClose={() => setSendConfirmModal(false)} title="Confirm Send" size="sm">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Send email to <strong className="text-[var(--color-text-primary)]">{recipientDesc}</strong>?
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setSendConfirmModal(false)}>Cancel</Button>
          <Button variant="primary" icon={Send} loading={sending} onClick={confirmSend}>Send</Button>
        </ModalFooter>
      </Modal>

      {/* Manage Templates Modal */}
      <Modal open={showManageTemplates} onClose={() => { setShowManageTemplates(false); setEditTemplate(null); }} title="Manage Templates" size="lg">
        <ModalBody>
          <div className="space-y-4">
            {/* Template list */}
            {templates.length === 0 ? (
              <p className="text-sm text-[var(--color-text-tertiary)]">No templates yet. Create one below.</p>
            ) : (
              <div className="space-y-2">
                {templates.map(t => (
                  <div key={t.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--color-border)]">
                    <div className="min-w-0 flex-1 mr-3">
                      <p className="font-medium text-sm text-[var(--color-text-primary)]">{t.name}</p>
                      <p className="text-xs text-[var(--color-text-tertiary)] truncate">{t.subject}</p>
                    </div>
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => {
                        setEditTemplate(t);
                        setTemplateForm({ name: t.name, subject: t.subject, body: t.body });
                      }}><Pencil className="h-3.5 w-3.5" /></Button>
                      <Button variant="ghost" size="sm" onClick={() => setDeleteTemplateModal(t)}><Trash2 className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Create/Edit form */}
            <div className="border-t border-[var(--color-border)] pt-4 space-y-3">
              <p className="text-sm font-medium text-[var(--color-text-primary)]">{editTemplate?.id ? "Edit Template" : "New Template"}</p>
              <Input label="Name" value={templateForm.name} onChange={(e) => setTemplateForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Welcome" />
              <Input label="Subject" value={templateForm.subject} onChange={(e) => setTemplateForm(f => ({ ...f, subject: e.target.value }))} placeholder="Email subject" />
              <Textarea label="Body" value={templateForm.body} onChange={(e) => setTemplateForm(f => ({ ...f, body: e.target.value }))} placeholder="Email body..." />
              <div className="flex gap-2">
                <Button variant="primary" size="sm" icon={Plus} loading={templateSaving} onClick={handleSaveTemplate}>
                  {editTemplate?.id ? "Update" : "Create"}
                </Button>
                {editTemplate?.id && (
                  <Button variant="ghost" size="sm" onClick={() => { setEditTemplate(null); setTemplateForm({ name: "", subject: "", body: "" }); }}>
                    Cancel Edit
                  </Button>
                )}
              </div>
            </div>
          </div>
        </ModalBody>
      </Modal>

      {/* Delete Template Confirmation */}
      <Modal open={!!deleteTemplateModal} onClose={() => setDeleteTemplateModal(null)} title="Delete Template" destructive size="sm">
        <ModalBody>
          <p className="text-sm text-[var(--color-text-secondary)]">
            Delete template <strong className="text-[var(--color-text-primary)]">{deleteTemplateModal?.name}</strong>? This cannot be undone.
          </p>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setDeleteTemplateModal(null)}>Cancel</Button>
          <Button variant="danger" icon={Trash2} onClick={handleDeleteTemplate}>Delete</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}

// ─── Preferences ────────────────────────────────────────────────────────────

const PREFS_PAGE_SIZE = 50;

function PreferencesSubView() {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

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
      if (mountedRef.current) {
        setAllPrefs(data || []);
        setPrefsCount(count || 0);
      }
    } catch {
      if (mountedRef.current) { setAllPrefs([]); setPrefsCount(0); }
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [filterOptedOut, page]);

  useEffect(() => { fetchPrefs(); }, [fetchPrefs]);
  useEffect(() => { setPage(0); }, [filterOptedOut]);

  useEffect(() => {
    async function fetchCounts() {
      try {
        const { count: total } = await supabase.from("notification_preferences").select("*", { count: "exact", head: true });
        const { count: optedOut } = await supabase.from("notification_preferences").select("*", { count: "exact", head: true }).eq("email_enabled", false);
        if (mountedRef.current) {
          setTotalCount(total || 0);
          setOptedOutCount(optedOut || 0);
        }
      } catch {
        // Table may not exist
      }
    }
    fetchCounts();
  }, []);

  useEffect(() => {
    if (!search.trim()) { setPrefs(allPrefs); return; }
    const s = search.toLowerCase();
    setPrefs(allPrefs.filter((p) => p.user?.display_name?.toLowerCase().includes(s) || p.user?.email?.toLowerCase().includes(s)));
  }, [search, allPrefs]);

  function boolBadge(val) {
    return val === true ? <Badge variant="success">On</Badge> : val === false ? <Badge variant="error">Off</Badge> : <Badge variant="default">—</Badge>;
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
      <div className="flex items-center gap-4 text-sm text-[var(--color-text-secondary)]">
        <span>Total users with preferences: <strong className="text-[var(--color-text-primary)]">{totalCount}</strong></span>
        <span>·</span>
        <span>
          Email opted out: <strong className="text-[var(--color-warning-700)]">{optedOutCount}</strong>
          {totalCount > 0 && <> ({((optedOutCount / totalCount) * 100).toFixed(0)}%)</>}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <SearchInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onClear={() => setSearch("")}
          placeholder="Search by name or email..."
          className="flex-1 max-w-md"
        />
        <Toggle label="Show only opted-out" checked={filterOptedOut} onChange={setFilterOptedOut} />
      </div>

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
