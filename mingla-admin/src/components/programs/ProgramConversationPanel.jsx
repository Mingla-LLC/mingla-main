// Issue #4187 — the shared Admin conversation panel used by both Creator and
// Mingla Local program surfaces. The server owns recipient eligibility,
// conversation reuse, message idempotency and Admin authorization. Persistent
// photos and videos use the same private #4114 chat-media bucket as Explorer.

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Film, Image as ImageIcon, MessageCircle, Paperclip, Send, X } from "lucide-react";
import { supabase } from "../../lib/supabase";
import {
  downloadProgramMedia,
  getProgramConversation,
  getProgramMediaUrl,
  prepareProgramMediaConversation,
  sendProgramMessage,
  uploadProgramMedia,
  validateProgramMedia,
} from "../../services/creatorProgramsService";
import { programErrorMessage, shortDateTime } from "../../lib/creatorPrograms";
import { Button } from "../ui/Button";
import { Textarea } from "../ui/Input";

function clientId() {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function mediaKey(file) {
  return file ? `${file.name}:${file.type}:${file.size}:${file.lastModified}` : "";
}

function mergeMessage(messages, message) {
  if (!message?.id) return messages;
  const withoutDuplicate = messages.filter((item) => item.id !== message.id);
  return [...withoutDuplicate, message].sort((left, right) => {
    const time = String(left.created_at).localeCompare(String(right.created_at));
    return time || String(left.id).localeCompare(String(right.id));
  });
}

function ProgramMedia({ message, incoming }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const expired = message.message_type === "video" && Boolean(message.media_expired_at);

  useEffect(() => {
    let active = true;
    if (!message.file_url || expired) return () => { active = false; };
    getProgramMediaUrl(message.file_url)
      .then((next) => { if (active) setUrl(next); })
      .catch(() => { if (active) setError("Media couldn't be loaded."); });
    return () => { active = false; };
  }, [expired, message.file_url]);

  const download = async () => {
    setDownloading(true);
    setError("");
    try {
      await downloadProgramMedia(message.file_url, message.file_name);
    } catch {
      setError("Download failed. Try again.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-black/10 bg-black/10">
      {expired ? (
        <div className="flex min-h-28 items-center justify-center gap-2 px-4 text-xs">
          <Film className="h-4 w-4" aria-hidden="true" /> Video expired after 90 days
        </div>
      ) : null}
      {!expired && !url && !error ? <div className="min-h-28 animate-pulse bg-black/10" role="status" aria-label="Loading media" /> : null}
      {!expired && url && message.message_type === "image" ? (
        <a href={url} target="_blank" rel="noreferrer" aria-label={`Open ${message.file_name || "photo"}`}>
          <img src={url} alt={message.file_name || "Photo shared in chat"} className="max-h-72 w-full object-contain" />
        </a>
      ) : null}
      {!expired && url && message.message_type === "video" ? (
        <video src={url} controls preload="metadata" className="max-h-72 w-full bg-black" aria-label={message.file_name || "Video shared in chat"} />
      ) : null}
      {error ? <p className={`px-3 py-2 text-xs ${incoming ? "text-[var(--color-error-700)]" : "text-white"}`} role="alert">{error}</p> : null}
      {!expired && message.file_url ? (
        <div className={`flex items-center justify-between gap-3 border-t border-black/10 px-3 py-2 text-xs ${incoming ? "text-[var(--color-text-secondary)]" : "text-white/80"}`}>
          <span className="min-w-0 truncate">{message.file_name || (message.message_type === "image" ? "Photo" : "Video")}</span>
          <button type="button" className="inline-flex shrink-0 items-center gap-1 font-semibold hover:underline disabled:opacity-60" onClick={() => void download()} disabled={downloading}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> {downloading ? "Downloading…" : "Download"}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SelectedMediaPreview({ file, sending, onRemove }) {
  const [previewUrl] = useState(() => URL.createObjectURL(file));
  useEffect(() => () => URL.revokeObjectURL(previewUrl), [previewUrl]);
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[var(--gray-200)] bg-[var(--gray-50)] p-2">
      <div className="h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-black/5">
        {file.type.startsWith("image/")
          ? <img src={previewUrl} alt="Selected attachment preview" className="h-full w-full object-cover" />
          : <video src={previewUrl} className="h-full w-full object-cover" aria-label="Selected video preview" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{file.name}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--color-text-secondary)]">
          {file.type.startsWith("image/") ? <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" /> : <Film className="h-3.5 w-3.5" aria-hidden="true" />}
          {(file.size / (1024 * 1024)).toFixed(1)} MB · sent as permanent chat media
        </p>
      </div>
      <button type="button" className="rounded-lg p-2 text-[var(--color-text-secondary)] hover:bg-[var(--gray-100)]" aria-label="Remove attachment" onClick={onRemove} disabled={sending}>
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ProgramConversationPanel({ programKind, targetUserId, recipientName }) {
  const [thread, setThread] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const retryRef = useRef(null);
  const mediaInputRef = useRef(null);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!targetUserId) return;
    if (!quiet) setLoading(true);
    setLoadError("");
    try {
      const result = await getProgramConversation(programKind, targetUserId);
      setThread(result);
    } catch (cause) {
      setLoadError(programErrorMessage(cause, "Couldn't load this conversation. Try again."));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [programKind, targetUserId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const conversationId = thread?.conversation_id;
    if (!conversationId) return undefined;
    const channel = supabase
      .channel(`admin-program-conversation-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        () => { void load({ quiet: true }); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, thread?.conversation_id]);

  const updateDraft = (event) => {
    const next = event.target.value;
    setDraft(next);
    setSendError("");
    if (retryRef.current?.content !== next.trim()) retryRef.current = null;
  };

  const chooseMedia = (event) => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = "";
    if (!file) return;
    try {
      validateProgramMedia(file);
      setSelectedMedia(file);
      setSendError("");
      retryRef.current = null;
    } catch (cause) {
      setSendError(programErrorMessage(cause, "Choose a supported photo or video up to 25 MB."));
    }
  };

  const clearMedia = () => {
    setSelectedMedia(null);
    setSendError("");
    retryRef.current = null;
  };

  const submit = async (event) => {
    event.preventDefault();
    const content = draft.trim();
    const fileKey = mediaKey(selectedMedia);
    if ((!content && !selectedMedia) || sending) return;
    const pending = retryRef.current?.content === content && retryRef.current?.fileKey === fileKey
      ? retryRef.current
      : { content, file: selectedMedia, fileKey, clientId: clientId(), uploaded: null };
    retryRef.current = pending;
    setSending(true);
    setSendError("");
    try {
      if (pending.file && !pending.uploaded) {
        const prepared = await prepareProgramMediaConversation(programKind, targetUserId);
        pending.uploaded = await uploadProgramMedia({
          conversationId: prepared.conversation_id,
          clientId: pending.clientId,
          file: pending.file,
        });
      }
      const result = await sendProgramMessage({
        programKind,
        targetUserId,
        content,
        clientId: pending.clientId,
        messageType: pending.uploaded?.kind ?? "text",
        fileUrl: pending.uploaded?.path ?? null,
        fileName: pending.uploaded?.fileName ?? null,
        fileSize: pending.uploaded?.fileSize ?? null,
      });
      setThread((current) => ({
        ...(current ?? {}),
        conversation_id: result.conversation_id,
        messages: mergeMessage(current?.messages ?? [], result.message),
      }));
      setDraft("");
      setSelectedMedia(null);
      retryRef.current = null;
    } catch (cause) {
      setSendError(programErrorMessage(cause, "Message not sent. Try again."));
    } finally {
      setSending(false);
    }
  };

  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  const name = thread?.recipient_name || recipientName || (programKind === "local" ? "this Local" : "this Creator");
  const canSend = Boolean(draft.trim() || selectedMedia) && !loading && !loadError;

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)]" aria-label={`Conversation with ${name}`}>
      <div className="flex items-center gap-3 border-b border-[var(--gray-200)] px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-600)]">
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-sm text-[var(--color-text-primary)]">Message {name}</strong>
          <span className="block text-xs text-[var(--color-text-secondary)]">Text, photos and videos appear in Explorer Chats. Replies arrive here.</span>
        </span>
      </div>

      <div className="max-h-[30rem] min-h-44 space-y-3 overflow-y-auto bg-[var(--gray-50)] px-4 py-4" aria-live="polite">
        {loading ? <p className="py-12 text-center text-sm text-[var(--color-text-secondary)]" role="status">Loading conversation…</p> : null}
        {!loading && loadError ? (
          <div className="py-8 text-center">
            <p role="alert" className="text-sm text-[var(--color-error-700)]">{loadError}</p>
            <Button className="mt-3" size="sm" variant="secondary" onClick={() => void load()}>Try again</Button>
          </div>
        ) : null}
        {!loading && !loadError && !messages.length ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-semibold text-[var(--color-text-primary)]">Start the conversation</p>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">The thread appears in {name}'s Chats after the first message.</p>
          </div>
        ) : null}
        {!loading && !loadError ? messages.map((message) => {
          const incoming = Boolean(message.is_from_recipient);
          return (
            <article key={message.id} className={`flex ${incoming ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[86%] rounded-xl px-3 py-2 ${incoming ? "border border-[var(--gray-200)] bg-[var(--color-background-primary)]" : "bg-[var(--color-brand-600)] text-white"}`}>
                <p className={`text-[11px] font-semibold ${incoming ? "text-[var(--color-text-secondary)]" : "text-white/75"}`}>{incoming ? message.sender_name : "Mingla team"}</p>
                {message.message_type === "image" || message.message_type === "video" ? <ProgramMedia message={message} incoming={incoming} /> : null}
                {message.content ? <p className={`mt-1 whitespace-pre-wrap break-words text-sm ${incoming ? "text-[var(--color-text-primary)]" : "text-white"}`}>{message.content}</p> : null}
                <p className={`mt-1 text-[10px] ${incoming ? "text-[var(--color-text-tertiary)]" : "text-white/65"}`}>{shortDateTime(message.created_at)}</p>
              </div>
            </article>
          );
        }) : null}
      </div>

      <form className="space-y-3 border-t border-[var(--gray-200)] p-3" onSubmit={(event) => void submit(event)}>
        {selectedMedia ? <SelectedMediaPreview key={mediaKey(selectedMedia)} file={selectedMedia} sending={sending} onRemove={clearMedia} /> : null}
        <Textarea
          aria-label={`Message ${name}`}
          placeholder={selectedMedia ? "Add a caption (optional)" : "Write a clear update or question"}
          className="min-h-20 font-sans"
          value={draft}
          maxLength={4000}
          disabled={loading || Boolean(loadError) || sending}
          onChange={updateDraft}
          error={sendError || undefined}
        />
        <input ref={mediaInputRef} type="file" className="sr-only" accept="image/jpeg,image/png,image/gif,image/webp,image/heic,image/heif,video/mp4,video/quicktime,video/x-m4v,video/3gpp,video/webm" onChange={chooseMedia} />
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="secondary" icon={Paperclip} disabled={loading || Boolean(loadError) || sending} onClick={() => mediaInputRef.current?.click()}>
              Add photo or video
            </Button>
            <span className="text-xs text-[var(--color-text-tertiary)]">Up to 25 MB</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-[var(--color-text-tertiary)]">{draft.trim().length}/4000</span>
            <Button type="submit" size="sm" icon={Send} loading={sending} disabled={!canSend}>{sending && selectedMedia ? "Uploading…" : "Send to Chats"}</Button>
          </div>
        </div>
      </form>
    </section>
  );
}
