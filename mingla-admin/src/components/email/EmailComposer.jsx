import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignLeft,
  Bold,
  CalendarClock,
  ChevronDown,
  FileImage,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link,
  List,
  ListOrdered,
  Minus,
  Monitor,
  Send,
  Smartphone,
  Sparkles,
  Underline,
  Users,
  X,
} from "lucide-react";
import { supabase } from "../../lib/supabase";
import minglaEmailWordmark from "../../../../packages/brand-assets/mingla-wordmark-email.png";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Modal, ModalBody, ModalFooter } from "../ui/Modal";
import { Spinner } from "../ui/Spinner";
import { useToast } from "../../context/ToastContext";

const TOKENS = [
  { value: "{first_name}", label: "First name", example: "Maya" },
  { value: "{display_name}", label: "Display name", example: "Maya Okafor" },
  { value: "{username}", label: "Username", example: "mayaexplores" },
  { value: "{country}", label: "Country", example: "NG" },
  { value: "{language}", label: "Language", example: "en" },
  { value: "{joined_date}", label: "Joined date", example: "Jan 15, 2026" },
];

const SAMPLE_VALUES = Object.fromEntries(TOKENS.map((token) => [token.value, token.example]));
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const EMPTY_FILTERS = {
  userType: "all",
  country: "all",
  onboarding: "all",
  accountStatus: "all",
  emailStatus: "all",
  language: "all",
  beta: "all",
  joinedFrom: "",
  joinedTo: "",
};

function blockId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;
}

function defaultDocument() {
  return [{
    id: blockId(),
    type: "rich_text",
    html: "<p>Hi {first_name},</p><p>Write your update here.</p>",
  }];
}

function replacePreviewTokens(value) {
  return Object.entries(SAMPLE_VALUES).reduce((current, [token, replacement]) => (
    current.split(token).join(replacement)
  ), value || "").split("{name}").join("Maya");
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
}

function sanitizeLocalRichText(value) {
  const allowed = new Set(["p", "h2", "h3", "strong", "b", "em", "i", "u", "ul", "ol", "li", "a", "br"]);
  return String(value)
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?([a-z0-9]+)(?:\s[^>]*)?>/gi, (raw, rawTag) => {
      const tag = rawTag.toLowerCase();
      if (!allowed.has(tag)) return "";
      if (raw.startsWith("</")) return `</${tag}>`;
      if (tag === "br") return "<br>";
      if (tag !== "a") return `<${tag}>`;
      const href = raw.match(/href\s*=\s*["']([^"']+)["']/i)?.[1];
      try {
        const parsed = new URL(href || "");
        return parsed.protocol === "https:"
          ? `<a href="${escapeHtml(parsed.toString())}" target="_blank" rel="noopener noreferrer">`
          : "<a>";
      } catch {
        return "<a>";
      }
    });
}

function plainTextFromDocument(documentValue) {
  return documentValue.map((block) => {
    if (block.type === "divider") return "────────";
    if (block.type === "image") return block.alt;
    const node = document.createElement("div");
    node.innerHTML = block.html;
    return node.textContent || "";
  }).filter(Boolean).join("\n\n");
}

function audienceFor(mode, email, filters) {
  if (mode === "person") return { mode, email: email.trim() };
  if (mode === "everyone") return { mode, filters: {} };
  return { mode, filters };
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label className="min-w-0">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">
        {label}
      </span>
      <span className="relative block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-9 w-full appearance-none rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 pr-8 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2.5 top-2.5 h-4 w-4 text-[var(--color-text-tertiary)]" />
      </span>
    </label>
  );
}

function LocalEmailPreview({ subject, documentValue }) {
  return (
    <div className="min-h-full bg-[#f4f1ed] px-3 py-5 sm:px-5">
      <div className="mx-auto max-w-[600px] overflow-hidden rounded-2xl border border-[#e7dfd6] bg-white shadow-sm">
        <div className="flex items-center justify-center border-b border-[#efe9e2] bg-white px-6 py-6">
          <img
            src={minglaEmailWordmark}
            alt="Mingla"
            className="h-8 w-[90px] object-contain"
          />
        </div>
        <div className="px-6 py-7 text-[#2d2926]">
          <h1 className="mb-5 text-[22px] font-bold leading-tight">{replacePreviewTokens(subject) || "Your Mingla update"}</h1>
          {documentValue.map((block) => {
            if (block.type === "divider") {
              return <hr key={block.id} className="my-6 border-0 border-t border-[#e6e0d9]" />;
            }
            if (block.type === "image") {
              const image = <img src={block.url} alt={block.alt || "Image description required"} className="my-5 h-auto w-full rounded-xl" />;
              let safeLink = "";
              try {
                const parsed = new URL(block.link || "");
                if (parsed.protocol === "https:") safeLink = parsed.toString();
              } catch {
                safeLink = "";
              }
              return safeLink ? <a key={block.id} href={safeLink}>{image}</a> : <div key={block.id}>{image}</div>;
            }
            return (
              <div
                key={block.id}
                className="email-local-preview text-[15px] leading-7 [&_a]:text-[#c4471a] [&_a]:underline [&_h2]:mb-3 [&_h2]:mt-6 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-4 [&_ul]:list-disc"
                dangerouslySetInnerHTML={{ __html: sanitizeLocalRichText(replacePreviewTokens(block.html)) }}
              />
            );
          })}
        </div>
        <div className="border-t border-[#efe9e2] px-6 py-5 text-xs leading-5 text-[#756e68]">
          <p>You’re receiving this email from Mingla.</p>
          <p><a className="underline" href="#unsubscribe">Unsubscribe</a> · Mingla, hello@usemingla.com</p>
        </div>
      </div>
    </div>
  );
}

export function EmailComposer({ callEdgeFunction, providerConfigured, onSessionExpired }) {
  const { addToast } = useToast();
  const [audienceMode, setAudienceMode] = useState("everyone");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [metadata, setMetadata] = useState({ countries: [], languages: [] });
  const [estimate, setEstimate] = useState(null);
  const [estimating, setEstimating] = useState(false);
  const [subject, setSubject] = useState("");
  const [documentValue, setDocumentValue] = useState(defaultDocument);
  const [activeBlockId, setActiveBlockId] = useState(null);
  const [previewMode, setPreviewMode] = useState("desktop");
  const [serverPreview, setServerPreview] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [scheduleMode, setScheduleMode] = useState("now");
  const [scheduledLocal, setScheduledLocal] = useState("");
  const [reviewOpen, setReviewOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const subjectRef = useRef(null);
  const editorRefs = useRef(new Map());
  const imageInputRef = useRef(null);
  const gifInputRef = useRef(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const audience = useMemo(
    () => audienceFor(audienceMode, recipientEmail, filters),
    [audienceMode, recipientEmail, filters],
  );

  const setFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      callEdgeFunction({ action: "metadata" }).catch(() => ({ countries: [], languages: [] })),
      supabase.from("email_templates").select("id,name,subject,body,body_document").order("name"),
    ]).then(([meta, templateResult]) => {
      if (cancelled) return;
      if (!meta?._noProvider) setMetadata({ countries: meta.countries || [], languages: meta.languages || [] });
      setTemplates(templateResult.data || []);
    });
    return () => { cancelled = true; };
  }, [callEdgeFunction]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (audienceMode === "person" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())) {
        setEstimate(null);
        setEstimating(false);
        return;
      }
      setEstimating(true);
      callEdgeFunction({ action: "estimate", audience })
        .then((result) => {
          if (!cancelled && !result?._noProvider) setEstimate(result);
        })
        .catch((error) => {
          if (error?.name === "SessionExpiredError") onSessionExpired?.();
          if (!cancelled) setEstimate(null);
        })
        .finally(() => { if (!cancelled) setEstimating(false); });
    }, 350);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [audience, audienceMode, callEdgeFunction, onSessionExpired, recipientEmail]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setPreviewLoading(true);
      callEdgeFunction({ action: "preview", subject, document: documentValue })
        .then((result) => {
          if (!cancelled && result?.html) setServerPreview(result.html);
        })
        .catch(() => {
          if (!cancelled) setServerPreview("");
        })
        .finally(() => { if (!cancelled) setPreviewLoading(false); });
    }, 500);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [callEdgeFunction, documentValue, subject]);

  function updateBlock(id, patch) {
    setDocumentValue((current) => current.map((block) => block.id === id ? { ...block, ...patch } : block));
  }

  function removeBlock(id) {
    setDocumentValue((current) => {
      const next = current.filter((block) => block.id !== id);
      return next.length ? next : defaultDocument();
    });
  }

  function syncActiveEditor() {
    if (!activeBlockId) return;
    const editor = editorRefs.current.get(activeBlockId);
    if (editor) updateBlock(activeBlockId, { html: editor.innerHTML });
  }

  function format(command, value = null) {
    const editor = editorRefs.current.get(activeBlockId);
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value);
    updateBlock(activeBlockId, { html: editor.innerHTML });
  }

  function addLink() {
    const raw = window.prompt("Paste an https:// link");
    if (!raw) return;
    try {
      const parsed = new URL(raw);
      if (parsed.protocol !== "https:") throw new Error("invalid");
      format("createLink", parsed.toString());
    } catch {
      addToast({ variant: "error", title: "Use a valid https:// link" });
    }
  }

  function insertToken(token, target = "body") {
    if (target === "subject") {
      const input = subjectRef.current;
      const start = input?.selectionStart ?? subject.length;
      const end = input?.selectionEnd ?? subject.length;
      setSubject(`${subject.slice(0, start)}${token}${subject.slice(end)}`);
      requestAnimationFrame(() => input?.focus());
      return;
    }
    const editor = editorRefs.current.get(activeBlockId);
    if (!editor) return;
    editor.focus();
    document.execCommand("insertText", false, token);
    updateBlock(activeBlockId, { html: editor.innerHTML });
  }

  function addDivider() {
    setDocumentValue((current) => [...current, { id: blockId(), type: "divider" }, { id: blockId(), type: "rich_text", html: "<p><br></p>" }]);
  }

  async function uploadAsset(file) {
    if (!file) return;
    if (!IMAGE_TYPES.has(file.type)) {
      addToast({ variant: "error", title: "Use PNG, JPEG, WebP, or GIF" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      addToast({ variant: "error", title: "Images must be 5 MiB or smaller" });
      return;
    }
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Your admin session expired");
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${user.id}/${Date.now()}-${blockId()}-${safeName}`;
      const { error } = await supabase.storage.from("admin-email-assets").upload(path, file, {
        cacheControl: "31536000",
        contentType: file.type,
        upsert: false,
      });
      if (error) throw error;
      const { data } = supabase.storage.from("admin-email-assets").getPublicUrl(path);
      setDocumentValue((current) => [...current, {
        id: blockId(),
        type: "image",
        url: data.publicUrl,
        alt: "",
        link: "",
      }]);
    } catch (error) {
      addToast({ variant: "error", title: "Upload failed", description: error.message });
    } finally {
      setUploading(false);
      if (imageInputRef.current) imageInputRef.current.value = "";
      if (gifInputRef.current) gifInputRef.current.value = "";
    }
  }

  function loadTemplate(templateId) {
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setSubject(template.subject || "");
    setDocumentValue(Array.isArray(template.body_document) && template.body_document.length
      ? template.body_document.map((block) => ({
        ...block,
        id: block.id || blockId(),
        ...(block.type === "rich_text" ? { html: sanitizeLocalRichText(block.html) } : {}),
      }))
      : [{ id: blockId(), type: "rich_text", html: `<p>${escapeHtml(String(template.body || "")).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>` }]);
  }

  function validationError(now) {
    if (!subject.trim()) return "Add a subject line";
    if (!plainTextFromDocument(documentValue).trim()) return "Add email content";
    if (documentValue.some((block) => block.type === "image" && !block.alt.trim())) return "Add alt text to every image or GIF";
    if (audienceMode === "person" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail.trim())) return "Enter a valid recipient email";
    if (scheduleMode === "later" && (!scheduledLocal || new Date(scheduledLocal).getTime() <= now)) return "Choose a future send time";
    if (!estimate || estimate.will_receive < 1) return "This audience has no eligible recipients";
    return null;
  }

  function openReview(now) {
    syncActiveEditor();
    const error = validationError(now);
    if (error) {
      addToast({ variant: "error", title: error });
      return;
    }
    setReviewOpen(true);
  }

  async function confirmCampaign() {
    setSending(true);
    try {
      const result = await callEdgeFunction({
        action: "create_campaign",
        audience,
        subject: subject.trim(),
        document: documentValue,
        scheduledFor: scheduleMode === "later" ? new Date(scheduledLocal).toISOString() : null,
        timezone,
      });
      const campaign = result.campaign;
      addToast({
        variant: "success",
        title: scheduleMode === "later" ? "Email scheduled" : "Email queued",
        description: `${campaign.will_receive.toLocaleString()} recipient${campaign.will_receive === 1 ? "" : "s"}; ${campaign.skipped_opt_out.toLocaleString()} opted out.`,
      });
      setReviewOpen(false);
      setSubject("");
      setDocumentValue(defaultDocument());
      setScheduleMode("now");
      setScheduledLocal("");
    } catch (error) {
      if (error?.name === "SessionExpiredError") onSessionExpired?.();
      else addToast({ variant: "error", title: "Campaign was not queued", description: error.message });
    } finally {
      setSending(false);
    }
  }

  const audienceLabel = audienceMode === "everyone"
    ? "Everyone"
    : audienceMode === "person"
      ? (recipientEmail || "One person")
      : `${estimate?.will_receive ?? "—"} matching users`;

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1.8fr)_minmax(340px,0.9fr)]">
      <section className="min-w-0 overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)]">
        {!providerConfigured && (
          <div role="alert" className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm text-amber-900">
            Preview is available, but sending is disabled until the Resend provider is configured.
          </div>
        )}

        <div className="border-b border-[var(--gray-200)] px-4 py-4 sm:px-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold text-[var(--color-text-primary)]">Audience</h2>
              <p className="text-xs text-[var(--color-text-tertiary)]">Choose everyone, combine filters, or send to one person.</p>
            </div>
            <div className="flex rounded-lg bg-[var(--gray-100)] p-1">
              {[
                ["everyone", "Everyone"],
                ["segment", "Segment"],
                ["person", "One person"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setAudienceMode(id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${audienceMode === id ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {audienceMode === "everyone" && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2.5 text-sm text-[var(--color-text-secondary)]">
              <Users className="h-4 w-4 text-[var(--color-brand-500)]" />
              All eligible Host and Explorer accounts. Suppressed addresses are always excluded.
            </div>
          )}
          {audienceMode === "person" && (
            <Input type="email" label="Recipient email" value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} placeholder="member@example.com" />
          )}
          {audienceMode === "segment" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <FilterSelect label="User type" value={filters.userType} onChange={(value) => setFilter("userType", value)}>
                  <option value="all">All</option><option value="host">Host</option><option value="explorer">Explorer</option>
                </FilterSelect>
                <FilterSelect label="Country" value={filters.country} onChange={(value) => setFilter("country", value)}>
                  <option value="all">All countries</option>
                  {metadata.countries.map((value) => <option key={value} value={value}>{value}</option>)}
                </FilterSelect>
                <FilterSelect label="Onboarding" value={filters.onboarding} onChange={(value) => setFilter("onboarding", value)}>
                  <option value="all">All</option><option value="completed">Completed</option><option value="incomplete">Incomplete</option>
                </FilterSelect>
                <FilterSelect label="Account status" value={filters.accountStatus} onChange={(value) => setFilter("accountStatus", value)}>
                  <option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option>
                </FilterSelect>
                <FilterSelect label="Email status" value={filters.emailStatus} onChange={(value) => setFilter("emailStatus", value)}>
                  <option value="all">All</option><option value="verified">Verified</option><option value="unverified">Unverified</option>
                </FilterSelect>
                <FilterSelect label="Language" value={filters.language} onChange={(value) => setFilter("language", value)}>
                  <option value="all">All languages</option>
                  {metadata.languages.map((value) => <option key={value} value={value}>{value}</option>)}
                </FilterSelect>
                <FilterSelect label="Beta tester" value={filters.beta} onChange={(value) => setFilter("beta", value)}>
                  <option value="all">All</option><option value="beta">Beta only</option><option value="non_beta">Not beta</option>
                </FilterSelect>
                <label><span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Joined from</span><input type="date" value={filters.joinedFrom} onChange={(event) => setFilter("joinedFrom", event.target.value)} className="h-9 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-xs text-[var(--color-text-primary)]" /></label>
                <label><span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Joined through</span><input type="date" value={filters.joinedTo} onChange={(event) => setFilter("joinedTo", event.target.value)} className="h-9 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-xs text-[var(--color-text-primary)]" /></label>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-[var(--color-text-secondary)]">Filters combine with AND.</span>
                <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); setAudienceMode("everyone"); }} className="font-semibold text-[var(--color-brand-600)] hover:underline">Clear all and send to everyone</button>
              </div>
            </div>
          )}

          <div className="mt-3 flex min-h-5 items-center gap-2 text-xs text-[var(--color-text-secondary)]">
            {estimating ? <><Spinner size="xs" /> Counting eligible recipients…</> : estimate ? (
              <><strong className="text-[var(--color-text-primary)]">{estimate.will_receive.toLocaleString()}</strong> will receive · {estimate.opted_out.toLocaleString()} opted out · {estimate.total.toLocaleString()} matched</>
            ) : <span>Recipient count appears here.</span>}
          </div>
        </div>

        <div className="space-y-4 p-4 sm:p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">From</p>
              <p className="mt-0.5 text-sm font-medium text-[var(--color-text-primary)]">Mingla &lt;hello@usemingla.com&gt;</p>
            </div>
            <div className="rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Replies</p>
              <p className="mt-0.5 text-sm font-medium text-[var(--color-text-primary)]">noreply@usemingla.com</p>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <label htmlFor="email-subject" className="text-sm font-medium text-[var(--color-text-primary)]">Subject</label>
              <div className="flex max-w-[70%] gap-1 overflow-x-auto pb-1" aria-label="Subject personalization">
                {TOKENS.map((token) => <button key={token.value} type="button" onClick={() => insertToken(token.value, "subject")} className="shrink-0 rounded-md border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] hover:border-[var(--color-brand-300)] hover:text-[var(--color-brand-700)]">+ {token.label}</button>)}
              </div>
            </div>
            <input id="email-subject" ref={subjectRef} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="A clear, personal subject line" className="h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]" />
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--gray-300)] bg-[var(--color-background-primary)] focus-within:border-[var(--color-brand-400)] focus-within:ring-2 focus-within:ring-[var(--color-brand-100)]">
            <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--gray-200)] bg-[var(--gray-50)] p-2">
              <button type="button" title="Heading" aria-label="Heading" onClick={() => format("formatBlock", "h2")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><Heading2 className="h-4 w-4" /></button>
              <button type="button" title="Paragraph" aria-label="Paragraph" onClick={() => format("formatBlock", "p")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><AlignLeft className="h-4 w-4" /></button>
              <button type="button" title="Bold" aria-label="Bold" onClick={() => format("bold")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><Bold className="h-4 w-4" /></button>
              <button type="button" title="Italic" aria-label="Italic" onClick={() => format("italic")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><Italic className="h-4 w-4" /></button>
              <button type="button" title="Underline" aria-label="Underline" onClick={() => format("underline")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><Underline className="h-4 w-4" /></button>
              <button type="button" title="Link" aria-label="Link" onClick={addLink} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><Link className="h-4 w-4" /></button>
              <button type="button" title="Bullet list" aria-label="Bullet list" onClick={() => format("insertUnorderedList")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><List className="h-4 w-4" /></button>
              <button type="button" title="Numbered list" aria-label="Numbered list" onClick={() => format("insertOrderedList")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><ListOrdered className="h-4 w-4" /></button>
              <span className="mx-1 h-5 w-px shrink-0 bg-[var(--gray-300)]" />
              <button type="button" title="Add image" onClick={() => imageInputRef.current?.click()} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]"><ImageIcon className="h-4 w-4" /> Image</button>
              <button type="button" title="Add GIF" onClick={() => gifInputRef.current?.click()} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]"><FileImage className="h-4 w-4" /> GIF</button>
              <button type="button" title="Add divider" onClick={addDivider} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]"><Minus className="h-4 w-4" /> Divider</button>
              {uploading && <Spinner size="xs" />}
              <input ref={imageInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(event) => uploadAsset(event.target.files?.[0])} />
              <input ref={gifInputRef} type="file" accept="image/gif" hidden onChange={(event) => uploadAsset(event.target.files?.[0])} />
            </div>

            <div className="min-h-[260px] space-y-2 p-4">
              {documentValue.map((block) => (
                <div key={block.id} className="group relative">
                  {block.type === "rich_text" && (
                    <div
                      ref={(node) => { if (node) editorRefs.current.set(block.id, node); else editorRefs.current.delete(block.id); }}
                      contentEditable
                      suppressContentEditableWarning
                      onFocus={() => setActiveBlockId(block.id)}
                      onInput={(event) => updateBlock(block.id, { html: event.currentTarget.innerHTML })}
                      className="min-h-12 rounded-lg px-2 py-1 text-sm leading-7 text-[var(--color-text-primary)] outline-none hover:bg-[var(--gray-50)] focus:bg-[var(--gray-50)] [&_a]:text-[var(--color-brand-600)] [&_a]:underline [&_h2]:my-2 [&_h2]:text-xl [&_h2]:font-bold [&_li]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_ul]:list-disc"
                      dangerouslySetInnerHTML={{ __html: sanitizeLocalRichText(block.html) }}
                    />
                  )}
                  {block.type === "divider" && <hr className="my-5 border-0 border-t border-[var(--gray-300)]" />}
                  {block.type === "image" && (
                    <div className="rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] p-3">
                      <img src={block.url} alt={block.alt} className="max-h-72 w-full rounded-lg object-contain" />
                      <div className="mt-3 grid gap-2 sm:grid-cols-2">
                        <Input label="Alt text (required)" value={block.alt} onChange={(event) => updateBlock(block.id, { alt: event.target.value })} placeholder="Describe the image" />
                        <Input label="Image link (optional)" value={block.link || ""} onChange={(event) => updateBlock(block.id, { link: event.target.value })} placeholder="https://…" />
                      </div>
                    </div>
                  )}
                  {documentValue.length > 1 && (
                    <button type="button" title="Remove block" onClick={() => removeBlock(block.id)} className="absolute -right-1 -top-1 hidden h-7 w-7 items-center justify-center rounded-full border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-tertiary)] shadow-sm hover:text-red-600 group-hover:flex"><X className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setDocumentValue((current) => [...current, { id: blockId(), type: "rich_text", html: "<p><br></p>" }])} className="text-xs font-semibold text-[var(--color-brand-600)] hover:underline">+ Add text block</button>
            </div>

            <div className="flex items-center gap-1 overflow-x-auto border-t border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2" aria-label="Insert personalization at cursor">
              <span className="mr-1 flex shrink-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.06em] text-[var(--color-text-tertiary)]"><Sparkles className="h-3.5 w-3.5" /> Insert at cursor</span>
              {TOKENS.map((token) => <button key={token.value} type="button" onClick={() => insertToken(token.value)} className="shrink-0 rounded-md border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-2 py-1 text-[11px] font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-brand-700)]">{token.label}</button>)}
            </div>
          </div>

          <div className="grid gap-3 border-t border-[var(--gray-200)] pt-4 md:grid-cols-[minmax(160px,0.6fr)_minmax(220px,1fr)_auto] md:items-end">
            <FilterSelect label="Template" value="" onChange={loadTemplate}>
              <option value="">Choose template…</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </FilterSelect>
            <div>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Delivery</span>
              <div className="flex min-h-9 flex-wrap items-center gap-2">
                <button type="button" onClick={() => setScheduleMode("now")} className={`h-9 rounded-lg border px-3 text-xs font-semibold ${scheduleMode === "now" ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-300)]"}`}>Send now</button>
                <button type="button" onClick={() => setScheduleMode("later")} className={`h-9 rounded-lg border px-3 text-xs font-semibold ${scheduleMode === "later" ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-300)]"}`}>Schedule</button>
                {scheduleMode === "later" && <input type="datetime-local" value={scheduledLocal} onChange={(event) => setScheduledLocal(event.target.value)} className="h-9 min-w-[195px] rounded-lg border border-[var(--gray-300)] px-2 text-xs" />}
              </div>
              <p className="mt-1 text-[11px] text-[var(--color-text-tertiary)]">{timezone}</p>
            </div>
            <Button icon={scheduleMode === "later" ? CalendarClock : Send} onClick={() => openReview(Date.now())} disabled={!providerConfigured || sending}>
              Review {scheduleMode === "later" ? "schedule" : "send"}
            </Button>
          </div>
        </div>
      </section>

      <aside className="min-w-0 self-start overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] shadow-[var(--shadow-sm)] xl:sticky xl:top-4">
        <div className="flex items-center justify-between border-b border-[var(--gray-200)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Live preview</h2>
            <p className="text-[11px] text-[var(--color-text-tertiary)]">Personalized as Maya · exact email shell</p>
          </div>
          <div className="flex rounded-lg bg-[var(--gray-100)] p-1">
            <button type="button" aria-label="Desktop preview" onClick={() => setPreviewMode("desktop")} className={`rounded-md p-1.5 ${previewMode === "desktop" ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-tertiary)]"}`}><Monitor className="h-4 w-4" /></button>
            <button type="button" aria-label="Mobile preview" onClick={() => setPreviewMode("mobile")} className={`rounded-md p-1.5 ${previewMode === "mobile" ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-tertiary)]"}`}><Smartphone className="h-4 w-4" /></button>
          </div>
        </div>
        <div className="border-b border-[var(--gray-200)] px-4 py-3 text-xs">
          <p className="truncate text-[var(--color-text-tertiary)]">To: <span className="font-medium text-[var(--color-text-primary)]">{audienceLabel}</span></p>
          <p className="truncate text-[var(--color-text-tertiary)]">Subject: <span className="font-medium text-[var(--color-text-primary)]">{replacePreviewTokens(subject) || "No subject yet"}</span></p>
        </div>
        <div className="relative flex min-h-[560px] justify-center overflow-auto bg-[var(--gray-100)] p-3">
          {previewLoading && <div className="absolute right-4 top-4 z-10 rounded-full bg-white p-2 shadow"><Spinner size="xs" /></div>}
          <div className={`overflow-hidden rounded-xl bg-white transition-all ${previewMode === "mobile" ? "w-[320px]" : "w-full"}`}>
            {serverPreview ? (
              <iframe title="Rendered email preview" sandbox="allow-popups" srcDoc={serverPreview} className="h-[720px] w-full border-0 bg-white" />
            ) : (
              <LocalEmailPreview subject={subject} documentValue={documentValue} />
            )}
          </div>
        </div>
      </aside>

      <Modal open={reviewOpen} onClose={() => !sending && setReviewOpen(false)} title={scheduleMode === "later" ? "Review scheduled email" : "Review email before sending"} size="md">
        <ModalBody>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] p-4">
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Recipients</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{estimate?.will_receive.toLocaleString()} eligible</p></div>
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Suppressed</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{estimate?.opted_out.toLocaleString()} excluded</p></div>
              <div className="col-span-2"><p className="text-xs text-[var(--color-text-tertiary)]">Audience</p><p className="mt-1 font-medium text-[var(--color-text-primary)]">{audienceLabel}</p></div>
              <div className="col-span-2"><p className="text-xs text-[var(--color-text-tertiary)]">When</p><p className="mt-1 font-medium text-[var(--color-text-primary)]">{scheduleMode === "later" ? `${new Date(scheduledLocal).toLocaleString()} (${timezone})` : "As soon as the delivery worker claims it"}</p></div>
            </div>
            <div><p className="text-xs text-[var(--color-text-tertiary)]">From</p><p className="font-medium">Mingla &lt;hello@usemingla.com&gt; · replies to noreply@usemingla.com</p></div>
            <div><p className="text-xs text-[var(--color-text-tertiary)]">Subject</p><p className="font-medium">{subject}</p></div>
            <p className="text-xs text-[var(--color-text-secondary)]">Every matching recipient is snapshotted before delivery. The worker retries temporary failures without creating duplicate provider sends.</p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setReviewOpen(false)} disabled={sending}>Go back</Button>
          <Button icon={scheduleMode === "later" ? CalendarClock : Send} onClick={confirmCampaign} loading={sending}>{scheduleMode === "later" ? "Schedule email" : "Queue email"}</Button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
