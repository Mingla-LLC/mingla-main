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
  Newspaper,
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
import { EmailBlogPostPicker } from "./EmailBlogPostPicker";
import {
  APP_STATUS_OPTIONS,
  AUDIENCE_PRESETS,
  EMPTY_FILTERS,
  audienceFor,
  audienceSummary,
  choosePreset,
  exclusionReasons,
  isRecipientChosen,
  presetIsActive,
} from "../../lib/emailAudience";
import {
  EMAIL_DRAFT_KEY,
  EMAIL_DRAFT_VERSION,
  LEGACY_EMAIL_DRAFT_KEYS,
  restoreDraftAudience,
} from "../../lib/emailDraftAudience";
import {
  appendEmailBlogPost,
  emailBlogPostValidationError,
  refreshEmailBlogPostSnapshots,
  swapEmailBlogPost,
} from "../../lib/emailBlogPostBlocks";

const TOKENS = [
  { value: "{first_name}", label: "First name", example: "Maya" },
  { value: "{display_name}", label: "Display name", example: "Maya Okafor" },
  { value: "{username}", label: "Username", example: "mayaexplores" },
  { value: "{country}", label: "Country", example: "Nigeria" },
  { value: "{language}", label: "Language", example: "English" },
  { value: "{joined_date}", label: "Joined date", example: "15 Jan 2026" },
];

const SAMPLE_VALUES = Object.fromEntries(TOKENS.map((token) => [token.value, token.example]));
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const DRAFT_KEY = EMAIL_DRAFT_KEY;

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
        return parsed.protocol === "https:" || (parsed.protocol === "mailto:" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.pathname))
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
    if (block.type === "blog_post") return block.snapshot?.title || "Blog post";
    const node = document.createElement("div");
    node.innerHTML = block.html;
    return node.textContent || "";
  }).filter(Boolean).join("\n\n");
}

function BlogPostSnapshot({ block, preview = false }) {
  const snapshot = block.snapshot || {};
  const href = snapshot.slug ? `https://usemingla.com/blog/${snapshot.slug}` : "#";
  const eyebrow = `${String(snapshot.categoryLabel || "Mingla").toUpperCase()} · ${Number(snapshot.readMinutes || 1)} MIN READ`;
  if (block.style === "link") {
    return (
      <p className={`text-sm leading-6 ${preview ? "my-4" : ""}`}>
        <a href={href} className="font-bold text-[#2d2926] no-underline">{snapshot.title || "Blog post"}</a>
        <span className="text-[#756e68]"> · </span>
        <a href={href} className="font-semibold text-[#c4471a]">{block.buttonText || "Add button text"}</a>
      </p>
    );
  }
  if (block.style === "row") {
    return (
      <div className="my-2 flex gap-3 rounded-xl border border-[#e6e0d9] bg-white p-3">
        {snapshot.coverUrl && <img src={snapshot.coverUrl} alt={snapshot.coverAlt || ""} className="h-[72px] w-24 shrink-0 rounded-lg object-cover" />}
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#a8450e]">{eyebrow}</p>
          <p className="mt-1 text-base font-extrabold leading-tight text-[#2d2926]">{snapshot.title || "Blog post"}</p>
          <p className="mt-1.5 text-xs font-bold text-[#c4471a]">{block.buttonText || "Add button text"} →</p>
        </div>
      </div>
    );
  }
  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-[#e6e0d9] bg-white">
      {snapshot.coverUrl && <img src={snapshot.coverUrl} alt={snapshot.coverAlt || ""} className="aspect-[2/1] w-full object-cover" />}
      <div className="p-4">
        <p className="text-[11px] font-bold uppercase tracking-wide text-[#a8450e]">{eyebrow}</p>
        <p className="mt-1.5 text-lg font-extrabold leading-tight text-[#2d2926]">{snapshot.title || "Blog post"}</p>
        {snapshot.summary && <p className="mt-2 text-sm leading-6 text-[#756e68]">{snapshot.summary}</p>}
        <span className="mt-3 inline-block rounded-full bg-[#c4471a] px-4 py-2 text-xs font-bold text-white">{block.buttonText || "Add button text"}</span>
      </div>
    </div>
  );
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
            if (block.type === "blog_post") return <BlogPostSnapshot key={block.id} block={block} preview />;
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

export function EmailComposer({ callEdgeFunction, providerConfigured, onSessionExpired, openTemplateManager = false }) {
  const { addToast } = useToast();
  const [audienceMode, setAudienceMode] = useState("segment");
  const [recipientQuery, setRecipientQuery] = useState("");
  const [recipientMatches, setRecipientMatches] = useState([]);
  const [selectedRecipient, setSelectedRecipient] = useState(null);
  const [recipientSearching, setRecipientSearching] = useState(false);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [metadata, setMetadata] = useState({ countries: [], languages: [], cities: [], brands: [] });
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
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkText, setLinkText] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [templateManagerOpen, setTemplateManagerOpen] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState("");
  const [templateName, setTemplateName] = useState("");
  const [templateSaving, setTemplateSaving] = useState(false);
  const [pendingTemplateDeleteId, setPendingTemplateDeleteId] = useState("");
  const [blogPickerBlockId, setBlogPickerBlockId] = useState(null);
  const [unavailableBlogPostIds, setUnavailableBlogPostIds] = useState(() => new Set());
  const subjectRef = useRef(null);
  const editorRefs = useRef(new Map());
  const imageInputRef = useRef(null);
  const gifInputRef = useRef(null);
  const linkRangeRef = useRef(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const audience = useMemo(
    () => audienceFor(audienceMode, selectedRecipient, filters),
    [audienceMode, selectedRecipient, filters],
  );
  const blogPostIdsKey = useMemo(() => [...new Set(documentValue.filter((block) => block.type === "blog_post").map((block) => block.postId))].sort().join(","), [documentValue]);

  useEffect(() => {
    if (!openTemplateManager) return undefined;
    const timer = setTimeout(() => setTemplateManagerOpen(true), 0);
    return () => clearTimeout(timer);
  }, [openTemplateManager]);

  const setFilter = useCallback((key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        let raw = localStorage.getItem(DRAFT_KEY);
        for (const legacyKey of LEGACY_EMAIL_DRAFT_KEYS) {
          if (!raw) raw = localStorage.getItem(legacyKey);
          localStorage.removeItem(legacyKey);
        }
        const saved = JSON.parse(raw || "null");
        if (!saved || ![1, EMAIL_DRAFT_VERSION].includes(saved.version)) return;
        // A restored draft never pre-selects an Explorer-reaching audience.
        const restored = restoreDraftAudience(saved, EMPTY_FILTERS);
        setAudienceMode(restored.audienceMode);
        setFilters(restored.filters);
        if (restored.audienceMode === "person") setSelectedRecipient(saved.selectedRecipient);
        if (typeof saved.subject === "string") setSubject(saved.subject);
        if (Array.isArray(saved.document) && saved.document.length) setDocumentValue(saved.document);
        if (["now", "later"].includes(saved.scheduleMode)) setScheduleMode(saved.scheduleMode);
        if (typeof saved.scheduledLocal === "string") setScheduledLocal(saved.scheduledLocal);
      } catch {
        localStorage.removeItem(DRAFT_KEY);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({
        version: EMAIL_DRAFT_VERSION,
        audienceMode,
        filters,
        selectedRecipient,
        subject,
        document: documentValue,
        scheduleMode,
        scheduledLocal,
      }));
    }, 300);
    return () => clearTimeout(timer);
  }, [audienceMode, documentValue, filters, scheduleMode, scheduledLocal, selectedRecipient, subject]);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      callEdgeFunction({ action: "metadata" }).catch(() => ({ countries: [], languages: [], cities: [], brands: [] })),
      supabase.from("email_templates").select("id,name,subject,body,body_document").order("name"),
    ]).then(([meta, templateResult]) => {
      if (cancelled) return;
      if (!meta?._noProvider) {
        setMetadata({
          countries: meta.countries || [],
          languages: meta.languages || [],
          cities: meta.cities || [],
          brands: meta.brands || [],
        });
      }
      setTemplates(templateResult.data || []);
    });
    return () => { cancelled = true; };
  }, [callEdgeFunction]);

  useEffect(() => {
    if (!blogPostIdsKey) return undefined;
    let cancelled = false;
    const ids = blogPostIdsKey.split(",");
    callEdgeFunction({ action: "blog_posts", ids })
      .then((result) => {
        if (cancelled) return;
        const posts = result.posts || [];
        const available = new Map(posts.map((post) => [post.postId, post.available]));
        setDocumentValue((current) => refreshEmailBlogPostSnapshots(current, posts).document);
        setUnavailableBlogPostIds(new Set(ids.filter((id) => available.get(id) !== true)));
      })
      .catch((error) => {
        if (error?.name === "SessionExpiredError") onSessionExpired?.();
      });
    return () => { cancelled = true; };
    // Snapshot changes do not change this key, so this runs once per restored,
    // loaded, added or swapped set of blog references.
  }, [blogPostIdsKey, callEdgeFunction, onSessionExpired]);

  useEffect(() => {
    let cancelled = false;
    if (audienceMode !== "person" || selectedRecipient || recipientQuery.trim().length < 2) {
      const timer = setTimeout(() => {
        if (!cancelled) {
          setRecipientMatches([]);
          setRecipientSearching(false);
        }
      }, 0);
      return () => { cancelled = true; clearTimeout(timer); };
    }
    const timer = setTimeout(() => {
      setRecipientSearching(true);
      callEdgeFunction({ action: "search_recipients", term: recipientQuery.trim() })
        .then((result) => {
          if (!cancelled) setRecipientMatches(result.recipients || []);
        })
        .catch((error) => {
          if (error?.name === "SessionExpiredError") onSessionExpired?.();
          if (!cancelled) setRecipientMatches([]);
        })
        .finally(() => { if (!cancelled) setRecipientSearching(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [audienceMode, callEdgeFunction, onSessionExpired, recipientQuery, selectedRecipient]);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      if (audienceMode === "person" && !isRecipientChosen(selectedRecipient)) {
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
  }, [audience, audienceMode, callEdgeFunction, onSessionExpired, selectedRecipient]);

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

  function format(command, value = null) {
    const editor = editorRefs.current.get(activeBlockId);
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, value);
    updateBlock(activeBlockId, { html: editor.innerHTML });
  }

  function openLinkDialog() {
    const editor = editorRefs.current.get(activeBlockId);
    if (!editor) {
      addToast({ variant: "error", title: "Place the cursor in the email body first" });
      return;
    }
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    linkRangeRef.current = range && editor.contains(range.commonAncestorContainer)
      ? range.cloneRange()
      : null;
    setLinkText(selection?.toString() || "");
    setLinkUrl("");
    setLinkOpen(true);
  }

  function confirmLink() {
    const editor = editorRefs.current.get(activeBlockId);
    if (!editor) return;
    let href;
    try {
      const parsed = new URL(linkUrl.trim());
      const safe = parsed.protocol === "https:" ||
        (parsed.protocol === "mailto:" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(parsed.pathname));
      if (!safe) throw new Error("invalid");
      href = parsed.toString();
    } catch {
      addToast({ variant: "error", title: "Use a valid https:// or mailto: link" });
      return;
    }
    const label = linkText.trim();
    if (!label) {
      addToast({ variant: "error", title: "Add link text" });
      return;
    }
    editor.focus();
    const selection = window.getSelection();
    if (selection && linkRangeRef.current) {
      selection.removeAllRanges();
      selection.addRange(linkRangeRef.current);
    }
    document.execCommand(
      "insertHTML",
      false,
      `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`,
    );
    updateBlock(activeBlockId, { html: editor.innerHTML });
    setLinkOpen(false);
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

  function chooseBlogPost(post) {
    setDocumentValue((current) => {
      if (blogPickerBlockId) return swapEmailBlogPost(current, blogPickerBlockId, post);
      if (current.filter((block) => block.type === "blog_post").length >= 3) {
        addToast({ variant: "error", title: "Use up to 3 blog posts per email" });
        return current;
      }
      return appendEmailBlogPost(current, post, blockId());
    });
    setBlogPickerBlockId(null);
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
    const templateBlocks = Array.isArray(template.body_document)
      ? template.body_document
      : template.body_document?.version === 1 && Array.isArray(template.body_document.blocks)
        ? template.body_document.blocks
        : null;
    setDocumentValue(templateBlocks?.length
      ? templateBlocks.map((block) => ({
        ...block,
        id: block.id || blockId(),
        ...(block.type === "rich_text" ? { html: sanitizeLocalRichText(block.html) } : {}),
      }))
      : [{ id: blockId(), type: "rich_text", html: `<p>${escapeHtml(String(template.body || "")).replace(/\n\n/g, "</p><p>").replace(/\n/g, "<br>")}</p>` }]);
  }

  async function saveTemplate() {
    if (!templateName.trim()) {
      addToast({ variant: "error", title: "Add a template name" });
      return;
    }
    if (!subject.trim() || !plainTextFromDocument(documentValue).trim()) {
      addToast({ variant: "error", title: "Add a subject and email body first" });
      return;
    }
    setTemplateSaving(true);
    const payload = {
      name: templateName.trim(),
      subject: subject.trim(),
      body: plainTextFromDocument(documentValue),
      body_document: { version: 1, blocks: documentValue },
    };
    try {
      const query = editingTemplateId
        ? supabase.from("email_templates").update(payload).eq("id", editingTemplateId)
        : supabase.from("email_templates").insert(payload);
      const { data, error } = await query.select("id,name,subject,body,body_document").single();
      if (error) throw error;
      setTemplates((current) => [...current.filter((item) => item.id !== data.id), data].sort((a, b) => a.name.localeCompare(b.name)));
      setEditingTemplateId(data.id);
      addToast({ variant: "success", title: editingTemplateId ? "Template updated" : "Template saved" });
    } catch (error) {
      addToast({ variant: "error", title: "Could not save template", description: error.message });
    } finally {
      setTemplateSaving(false);
    }
  }

  async function deleteTemplate(template) {
    try {
      const { error } = await supabase.from("email_templates").delete().eq("id", template.id);
      if (error) throw error;
      setTemplates((current) => current.filter((item) => item.id !== template.id));
      if (editingTemplateId === template.id) {
        setEditingTemplateId("");
        setTemplateName("");
      }
      setPendingTemplateDeleteId("");
      addToast({ variant: "success", title: "Template deleted" });
    } catch (error) {
      addToast({ variant: "error", title: "Could not delete template", description: error.message });
    }
  }

  function validationError(now, candidateDocument = documentValue, unavailableIds = unavailableBlogPostIds) {
    if (!subject.trim()) return "Add a subject line";
    if (!plainTextFromDocument(candidateDocument).trim()) return "Add email content";
    const blogError = emailBlogPostValidationError(candidateDocument, unavailableIds);
    if (blogError) return blogError;
    const allowedTokens = new Set([...TOKENS.map((token) => token.value.slice(1, -1)), "name"]);
    const tokenValues = [subject, ...candidateDocument.flatMap((block) => block.type === "rich_text" ? [block.html] : block.type === "image" ? [block.alt] : [])];
    for (const value of tokenValues) {
      for (const match of value.matchAll(/\{([^{}]+)\}/g)) {
        if (!allowedTokens.has(match[1])) return `Remove unsupported personalization token {${match[1]}}`;
      }
    }
    if (candidateDocument.some((block) => block.type === "image" && !block.alt.trim())) return "Add alt text to every image or GIF";
    if (audienceMode === "person" && !isRecipientChosen(selectedRecipient)) return "Choose an eligible Mingla recipient";
    if (scheduleMode === "later" && (!scheduledLocal || new Date(scheduledLocal).getTime() <= now)) return "Choose a future send time";
    if (!estimate || estimate.will_receive < 1) return "This audience has no eligible recipients";
    return null;
  }

  async function openReview(now) {
    const activeEditor = activeBlockId ? editorRefs.current.get(activeBlockId) : null;
    let candidateDocument = documentValue.map((block) => block.id === activeBlockId && activeEditor
      ? { ...block, html: activeEditor.innerHTML }
      : block);
    let unavailableIds = unavailableBlogPostIds;
    const ids = [...new Set(candidateDocument.filter((block) => block.type === "blog_post").map((block) => block.postId))];
    if (ids.length) {
      try {
        const result = await callEdgeFunction({ action: "blog_posts", ids });
        const refreshed = refreshEmailBlogPostSnapshots(candidateDocument, result.posts || []);
        candidateDocument = refreshed.document;
        unavailableIds = refreshed.unavailablePostIds;
        setUnavailableBlogPostIds(unavailableIds);
      } catch (refreshError) {
        if (refreshError?.name === "SessionExpiredError") onSessionExpired?.();
        addToast({ variant: "error", title: "Blog posts couldn't be checked", description: refreshError.message });
        return;
      }
    }
    setDocumentValue(candidateDocument);
    const error = validationError(now, candidateDocument, unavailableIds);
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
      setAudienceMode("segment");
      setFilters(EMPTY_FILTERS);
      setSelectedRecipient(null);
      setRecipientQuery("");
      setScheduleMode("now");
      setScheduledLocal("");
      localStorage.removeItem(DRAFT_KEY);
    } catch (error) {
      if (error?.name === "SessionExpiredError") onSessionExpired?.();
      else addToast({ variant: "error", title: "Campaign was not queued", description: error.message });
    } finally {
      setSending(false);
    }
  }

  const audienceLabel = audienceSummary(audienceMode, filters, estimate, selectedRecipient);
  const leftOut = exclusionReasons(estimate);

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
              <p className="text-xs text-[var(--color-text-tertiary)]">Hosts are the default. Explorer and ticket-buyer sends always require an explicit choice and count review. Ticket buyers only get marketing email if they agreed to it.</p>
            </div>
            <div className="flex rounded-lg bg-[var(--gray-100)] p-1">
              {AUDIENCE_PRESETS.map((preset) => {
                const active = presetIsActive(preset, audienceMode, filters);
                return (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      const next = choosePreset(preset, filters);
                      setAudienceMode(next.audienceMode);
                      if (next.filters !== filters) setFilters(next.filters);
                    }}
                    className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${active ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"}`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>
          </div>

          {audienceMode === "everyone" && (
            <div className="flex items-center gap-2 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2.5 text-sm text-[var(--color-text-secondary)]">
              <Users className="h-4 w-4 text-[var(--color-brand-500)]" />
              Everyone with the Host or Explorer app. Staff, test and unsubscribed addresses are always left out.
            </div>
          )}
          {audienceMode === "person" && (
            <div className="relative">
              <label htmlFor="email-recipient-search" className="mb-1 block text-xs font-semibold text-[var(--color-text-secondary)]">Mingla recipient</label>
              {selectedRecipient ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--gray-300)] bg-[var(--gray-50)] px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{selectedRecipient.display_name}</p>
                    <p className="truncate text-xs text-[var(--color-text-secondary)]">{selectedRecipient.email || selectedRecipient.exclusion} · {selectedRecipient.account_type} · {selectedRecipient.country}</p>
                  </div>
                  <button type="button" onClick={() => { setSelectedRecipient(null); setRecipientQuery(""); }} className="shrink-0 text-xs font-semibold text-[var(--color-brand-700)] hover:underline">Change</button>
                </div>
              ) : (
                <>
                  <input
                    id="email-recipient-search"
                    value={recipientQuery}
                    onChange={(event) => setRecipientQuery(event.target.value)}
                    placeholder="Search a Mingla member or ticket buyer by name or email"
                    autoComplete="off"
                    className="h-10 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
                  />
                  {(recipientSearching || recipientMatches.length > 0) && (
                    <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1 shadow-lg">
                      {recipientSearching ? (
                        <div className="flex items-center gap-2 px-3 py-3 text-xs text-[var(--color-text-secondary)]"><Spinner size="xs" /> Searching Mingla members…</div>
                      ) : recipientMatches.map((person) => (
                        <button
                          key={person.profile_id || person.email}
                          type="button"
                          onClick={() => { setSelectedRecipient(person); setRecipientQuery(person.display_name); setRecipientMatches([]); }}
                          disabled={!person.eligible}
                          className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-[var(--gray-50)] disabled:cursor-not-allowed disabled:opacity-55"
                        >
                          <span className="min-w-0"><span className="block truncate text-sm font-medium text-[var(--color-text-primary)]">{person.display_name} <span className="font-normal text-[var(--color-text-tertiary)]">{person.username}</span></span><span className="block truncate text-xs text-[var(--color-text-secondary)]">{person.email || person.exclusion} · {person.account_type} · {person.country}</span></span>
                          <span className={`shrink-0 text-[11px] font-semibold ${person.eligible ? "text-emerald-700" : "text-amber-700"}`}>{person.eligible ? "Eligible" : person.exclusion}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {audienceMode === "segment" && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                <FilterSelect label="User type" value={filters.userType} onChange={(value) => setFilter("userType", value)}>
                  <option value="all">All</option><option value="host">Host</option><option value="explorer">Explorer</option><option value="ticket_buyers">Ticket buyers</option>
                </FilterSelect>
                <FilterSelect label="App status" value={filters.appStatus} onChange={(value) => setFilter("appStatus", value)}>
                  <option value="all">All</option>
                  {APP_STATUS_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </FilterSelect>
                <FilterSelect label="Event city" value={filters.city} onChange={(value) => setFilter("city", value)}>
                  <option value="all">All cities</option>
                  {metadata.cities.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </FilterSelect>
                <FilterSelect label="Bought tickets" value={filters.boughtTickets} onChange={(value) => setFilter("boughtTickets", value)}>
                  <option value="all">All</option><option value="yes">Yes</option><option value="no">No</option>
                </FilterSelect>
                <FilterSelect label="Brand bought from" value={filters.brandId} onChange={(value) => setFilter("brandId", value)}>
                  <option value="all">All brands</option>
                  {metadata.brands.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </FilterSelect>
                <FilterSelect label="Country" value={filters.country} onChange={(value) => setFilter("country", value)}>
                  <option value="all">All countries</option>
                  {metadata.countries.map((option) => {
                    const value = typeof option === "string" ? option : option.value;
                    const label = typeof option === "string" ? option : option.label;
                    return <option key={value} value={value}>{label}{label !== value ? ` (${value})` : ""}</option>;
                  })}
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
                  {metadata.languages.map((option) => {
                    const value = typeof option === "string" ? option : option.value;
                    const label = typeof option === "string" ? option : option.label;
                    return <option key={value} value={value}>{label}</option>;
                  })}
                </FilterSelect>
                <FilterSelect label="Beta tester" value={filters.beta} onChange={(value) => setFilter("beta", value)}>
                  <option value="all">All</option><option value="beta">Beta only</option><option value="non_beta">Not beta</option>
                </FilterSelect>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor="email-joined-from" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Joined from</label>
                    <button type="button" onClick={() => setFilter("joinedFrom", "")} className={`text-[10px] font-semibold ${filters.joinedFrom ? "text-[var(--color-brand-700)] hover:underline" : "text-[var(--color-text-tertiary)]"}`}>All</button>
                  </div>
                  <input id="email-joined-from" type="date" value={filters.joinedFrom} onChange={(event) => setFilter("joinedFrom", event.target.value)} className="h-9 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-xs text-[var(--color-text-primary)]" />
                </div>
                <div>
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <label htmlFor="email-joined-through" className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Joined through</label>
                    <button type="button" onClick={() => setFilter("joinedTo", "")} className={`text-[10px] font-semibold ${filters.joinedTo ? "text-[var(--color-brand-700)] hover:underline" : "text-[var(--color-text-tertiary)]"}`}>All</button>
                  </div>
                  <input id="email-joined-through" type="date" value={filters.joinedTo} onChange={(event) => setFilter("joinedTo", event.target.value)} className="h-9 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-2 text-xs text-[var(--color-text-primary)]" />
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-[var(--color-text-secondary)]">Filters combine with AND.</span>
                <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); setAudienceMode("everyone"); }} className="font-semibold text-[var(--color-brand-600)] hover:underline">Clear all and send to everyone</button>
              </div>
            </div>
          )}

          <div className="mt-3 flex min-h-5 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-text-secondary)]" aria-live="polite">
            {estimating ? <><Spinner size="xs" /> Counting eligible recipients…</> : estimate ? (
              <><strong className="text-[var(--color-text-primary)]">{estimate.matched.toLocaleString()}</strong> matched · <strong className="text-[var(--color-text-primary)]">{estimate.will_receive.toLocaleString()}</strong> will receive{leftOut.map((reason) => <span key={reason.key}> · {reason.count.toLocaleString()} {reason.label}</span>)}</>
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
              <details className="relative"><summary className="cursor-pointer list-none rounded-md border border-[var(--gray-200)] px-2 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)]">Insert ▾</summary><div className="absolute right-0 z-30 mt-1 w-44 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1 shadow-lg">{TOKENS.map((token) => <button key={token.value} type="button" onClick={() => insertToken(token.value, "subject")} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--gray-50)]">{token.label}</button>)}</div></details>
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
              <button type="button" title="Link" aria-label="Link" onClick={openLinkDialog} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><Link className="h-4 w-4" /></button>
              <button type="button" title="Bullet list" aria-label="Bullet list" onClick={() => format("insertUnorderedList")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><List className="h-4 w-4" /></button>
              <button type="button" title="Numbered list" aria-label="Numbered list" onClick={() => format("insertOrderedList")} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)] hover:text-[var(--color-text-primary)]"><ListOrdered className="h-4 w-4" /></button>
              <span className="mx-1 h-5 w-px shrink-0 bg-[var(--gray-300)]" />
              <button type="button" title="Add image" onClick={() => imageInputRef.current?.click()} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]"><ImageIcon className="h-4 w-4" /> Image</button>
              <button type="button" title="Add GIF" onClick={() => gifInputRef.current?.click()} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]"><FileImage className="h-4 w-4" /> GIF</button>
              <button type="button" title="Add divider" onClick={addDivider} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]"><Minus className="h-4 w-4" /> Divider</button>
              <button type="button" title="Add blog post" onClick={() => setBlogPickerBlockId("")} className="flex h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-[var(--color-background-primary)]"><Newspaper className="h-4 w-4" /> Blog post</button>
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
                  {block.type === "blog_post" && (
                    <div className="rounded-xl border border-[var(--gray-300)] bg-[var(--gray-50)] p-3">
                      <div className="mb-3 flex flex-wrap items-center gap-2">
                        <span className="mr-auto text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Blog post</span>
                        <div className="flex rounded-lg bg-[var(--gray-200)] p-0.5" aria-label="Blog post layout">
                          {[["card", "Card with cover"], ["row", "Compact row"], ["link", "Title link only"]].map(([style, label]) => (
                            <button key={style} type="button" title={label} aria-pressed={block.style === style} onClick={() => updateBlock(block.id, { style })} className={`rounded-md px-2 py-1 text-[11px] font-semibold ${block.style === style ? "bg-white text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-secondary)]"}`}>{label}</button>
                          ))}
                        </div>
                        <button type="button" onClick={() => setBlogPickerBlockId(block.id)} className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline">Swap</button>
                        <button type="button" aria-label="Remove blog post" onClick={() => removeBlock(block.id)} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--color-text-tertiary)] hover:bg-red-50 hover:text-red-700"><X className="h-4 w-4" /></button>
                      </div>
                      {unavailableBlogPostIds.has(block.postId) && <p role="alert" className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-800">This post is no longer published. Swap or remove it.</p>}
                      <BlogPostSnapshot block={block} />
                      <div className="mt-3">
                        <Input label="Button text" maxLength={40} value={block.buttonText} onChange={(event) => updateBlock(block.id, { buttonText: event.target.value })} placeholder="Add button text" />
                        <p className="mt-1.5 text-xs text-[var(--color-text-tertiary)]">Links to usemingla.com/blog/{block.snapshot?.slug || "…"}. Title, summary and cover come from the post and update if the post is edited before sending.</p>
                      </div>
                    </div>
                  )}
                  {block.type !== "blog_post" && documentValue.length > 1 && (
                    <button type="button" title="Remove block" onClick={() => removeBlock(block.id)} className="absolute -right-1 -top-1 hidden h-7 w-7 items-center justify-center rounded-full border border-[var(--gray-200)] bg-[var(--color-background-primary)] text-[var(--color-text-tertiary)] shadow-sm hover:text-red-600 group-hover:flex"><X className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              ))}
              <button type="button" onClick={() => setDocumentValue((current) => [...current, { id: blockId(), type: "rich_text", html: "<p><br></p>" }])} className="text-xs font-semibold text-[var(--color-brand-600)] hover:underline">+ Add text block</button>
            </div>

            <div className="flex items-center justify-end border-t border-[var(--gray-200)] bg-[var(--gray-50)] px-3 py-2"><details className="relative"><summary className="flex cursor-pointer list-none items-center gap-1 rounded-md border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-2 py-1 text-[11px] font-semibold text-[var(--color-text-secondary)]"><Sparkles className="h-3.5 w-3.5" /> Insert ▾</summary><div className="absolute bottom-full right-0 z-30 mb-1 w-44 rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] p-1 shadow-lg">{TOKENS.map((token) => <button key={token.value} type="button" onClick={() => insertToken(token.value)} className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-[var(--gray-50)]">{token.label}</button>)}</div></details></div>
          </div>

          <div className="grid gap-3 border-t border-[var(--gray-200)] pt-4 md:grid-cols-[minmax(210px,0.75fr)_minmax(220px,1fr)_auto] md:items-end">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
              <FilterSelect label="Template" value="" onChange={loadTemplate}>
                <option value="">Choose template…</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </FilterSelect>
              <button
                type="button"
                onClick={() => {
                  setEditingTemplateId("");
                  setTemplateName("");
                  setPendingTemplateDeleteId("");
                  setTemplateManagerOpen(true);
                }}
                className="h-9 rounded-lg border border-[var(--gray-300)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] hover:border-[var(--color-brand-300)] hover:text-[var(--color-brand-700)]"
              >
                Manage
              </button>
            </div>
            <div>
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Delivery</span>
              <div className="flex min-h-9 flex-wrap items-center gap-2">
                <button type="button" aria-pressed={scheduleMode === "now"} onClick={() => setScheduleMode("now")} className={`h-9 rounded-lg border px-3 text-xs font-semibold ${scheduleMode === "now" ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-300)]"}`}>Send now</button>
                <button type="button" aria-pressed={scheduleMode === "later"} onClick={() => setScheduleMode("later")} className={`h-9 rounded-lg border px-3 text-xs font-semibold ${scheduleMode === "later" ? "border-[var(--color-brand-500)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]" : "border-[var(--gray-300)]"}`}>Schedule</button>
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
            <button type="button" aria-label="Desktop preview" aria-pressed={previewMode === "desktop"} onClick={() => setPreviewMode("desktop")} className={`rounded-md p-1.5 ${previewMode === "desktop" ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-tertiary)]"}`}><Monitor className="h-4 w-4" /></button>
            <button type="button" aria-label="Mobile preview" aria-pressed={previewMode === "mobile"} onClick={() => setPreviewMode("mobile")} className={`rounded-md p-1.5 ${previewMode === "mobile" ? "bg-[var(--color-background-primary)] text-[var(--color-text-primary)] shadow-sm" : "text-[var(--color-text-tertiary)]"}`}><Smartphone className="h-4 w-4" /></button>
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

      <EmailBlogPostPicker
        open={blogPickerBlockId !== null}
        onClose={() => setBlogPickerBlockId(null)}
        callEdgeFunction={callEdgeFunction}
        existingPostIds={new Set(documentValue.filter((block) => block.type === "blog_post" && block.id !== blogPickerBlockId).map((block) => block.postId))}
        onChoose={chooseBlogPost}
      />

      <Modal open={linkOpen} onClose={() => setLinkOpen(false)} title="Add hyperlink" size="sm">
        <ModalBody>
          <div className="space-y-3">
            <Input label="Text to display" value={linkText} onChange={(event) => setLinkText(event.target.value)} placeholder="Read the update" />
            <Input label="Destination" value={linkUrl} onChange={(event) => setLinkUrl(event.target.value)} placeholder="https://… or mailto:…" />
            <p className="text-xs text-[var(--color-text-tertiary)]">Only secure web links and valid email links are accepted.</p>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setLinkOpen(false)}>Cancel</Button>
          <Button onClick={confirmLink}>Insert link</Button>
        </ModalFooter>
      </Modal>

      <Modal open={templateManagerOpen} onClose={() => !templateSaving && setTemplateManagerOpen(false)} title="Manage email templates" size="md">
        <ModalBody>
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--gray-200)] bg-[var(--gray-50)] p-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <Input
                  label={editingTemplateId ? "Template name" : "New template name"}
                  value={templateName}
                  onChange={(event) => setTemplateName(event.target.value)}
                  placeholder="e.g. Monthly product update"
                />
                <Button onClick={saveTemplate} loading={templateSaving}>
                  {editingTemplateId ? "Update with current email" : "Save current email"}
                </Button>
              </div>
              {editingTemplateId && (
                <button
                  type="button"
                  onClick={() => { setEditingTemplateId(""); setTemplateName(""); }}
                  className="mt-2 text-xs font-semibold text-[var(--color-brand-700)] hover:underline"
                >
                  Save as a new template instead
                </button>
              )}
              <p className="mt-2 text-xs text-[var(--color-text-tertiary)]">Saves the current subject, formatting, links, images, GIFs, and dividers.</p>
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-[var(--color-text-tertiary)]">Saved templates</p>
              {templates.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--gray-300)] px-4 py-6 text-center text-sm text-[var(--color-text-tertiary)]">No templates saved yet.</p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
                  {templates.map((template) => (
                    <div key={template.id} className="rounded-lg border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-3 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{template.name}</p>
                          <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">{template.subject || "No subject"}</p>
                        </div>
                        {pendingTemplateDeleteId !== template.id && (
                          <div className="flex shrink-0 items-center gap-2">
                            <button type="button" onClick={() => { loadTemplate(template.id); setTemplateManagerOpen(false); }} className="text-xs font-semibold text-[var(--color-brand-700)] hover:underline">Use</button>
                            <button type="button" onClick={() => { loadTemplate(template.id); setEditingTemplateId(template.id); setTemplateName(template.name); }} className="text-xs font-semibold text-[var(--color-text-secondary)] hover:underline">Edit</button>
                            <button type="button" onClick={() => setPendingTemplateDeleteId(template.id)} className="text-xs font-semibold text-red-600 hover:underline">Delete</button>
                          </div>
                        )}
                      </div>
                      {pendingTemplateDeleteId === template.id && (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800">
                          <span>Delete this template permanently?</span>
                          <span className="flex items-center gap-2">
                            <button type="button" onClick={() => setPendingTemplateDeleteId("")} className="font-semibold hover:underline">Keep</button>
                            <button type="button" onClick={() => deleteTemplate(template)} className="rounded-md bg-red-600 px-2.5 py-1 font-semibold text-white hover:bg-red-700">Delete</button>
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <Button variant="secondary" onClick={() => setTemplateManagerOpen(false)} disabled={templateSaving}>Done</Button>
        </ModalFooter>
      </Modal>

      <Modal open={reviewOpen} onClose={() => !sending && setReviewOpen(false)} title={scheduleMode === "later" ? "Review scheduled email" : "Review email before sending"} size="md">
        <ModalBody>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--gray-200)] bg-[var(--gray-50)] p-4 sm:grid-cols-3">
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Matched</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{estimate?.matched.toLocaleString()}</p></div>
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Recipients</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{estimate?.will_receive.toLocaleString()} eligible</p></div>
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Unsubscribed</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{estimate?.opted_out.toLocaleString()}</p></div>
              <div><p className="text-xs text-[var(--color-text-tertiary)]">No valid email</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{estimate?.no_contact.toLocaleString()}</p></div>
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Duplicate email</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{estimate?.duplicate.toLocaleString()}</p></div>
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Didn't agree to marketing</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{Number(estimate?.no_consent || 0).toLocaleString()}</p></div>
              <div><p className="text-xs text-[var(--color-text-tertiary)]">Staff and test</p><p className="mt-1 font-semibold text-[var(--color-text-primary)]">{Number(estimate?.internal || 0).toLocaleString()}</p></div>
              <div className="col-span-2 sm:col-span-3"><p className="text-xs text-[var(--color-text-tertiary)]">Audience</p><p className="mt-1 font-medium text-[var(--color-text-primary)]">{audienceLabel}</p></div>
              <div className="col-span-2 sm:col-span-3"><p className="text-xs text-[var(--color-text-tertiary)]">When</p><p className="mt-1 font-medium text-[var(--color-text-primary)]">{scheduleMode === "later" ? `${new Date(scheduledLocal).toLocaleString()} (${timezone})` : "As soon as the delivery worker claims it"}</p></div>
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
