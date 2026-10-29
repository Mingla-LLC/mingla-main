// Issue #4187 — the shared Admin conversation panel used by both Creator and
// Mingla Local program surfaces. The server owns recipient eligibility,
// conversation reuse, message idempotency and Admin authorization.

import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle, Send } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { getProgramConversation, sendProgramMessage } from "../../services/creatorProgramsService";
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

function mergeMessage(messages, message) {
  if (!message?.id) return messages;
  const withoutDuplicate = messages.filter((item) => item.id !== message.id);
  return [...withoutDuplicate, message].sort((left, right) => {
    const time = String(left.created_at).localeCompare(String(right.created_at));
    return time || String(left.id).localeCompare(String(right.id));
  });
}

export function ProgramConversationPanel({ programKind, targetUserId, recipientName }) {
  const [thread, setThread] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState("");
  const [sending, setSending] = useState(false);
  const retryRef = useRef(null);

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

  const submit = async (event) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    const pending = retryRef.current?.content === content
      ? retryRef.current
      : { content, clientId: clientId() };
    retryRef.current = pending;
    setSending(true);
    setSendError("");
    try {
      const result = await sendProgramMessage({
        programKind,
        targetUserId,
        content,
        clientId: pending.clientId,
      });
      setThread((current) => ({
        ...(current ?? {}),
        conversation_id: result.conversation_id,
        messages: mergeMessage(current?.messages ?? [], result.message),
      }));
      setDraft("");
      retryRef.current = null;
    } catch (cause) {
      setSendError(programErrorMessage(cause, "Message not sent. Try again."));
    } finally {
      setSending(false);
    }
  };

  const messages = Array.isArray(thread?.messages) ? thread.messages : [];
  const name = thread?.recipient_name || recipientName || (programKind === "local" ? "this Local" : "this Creator");

  return (
    <section className="overflow-hidden rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)]" aria-label={`Conversation with ${name}`}>
      <div className="flex items-center gap-3 border-b border-[var(--gray-200)] px-4 py-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-brand-50)] text-[var(--color-brand-600)]">
          <MessageCircle className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0">
          <strong className="block truncate text-sm text-[var(--color-text-primary)]">Message {name}</strong>
          <span className="block text-xs text-[var(--color-text-secondary)]">They receive this in Explorer Chats and can reply there.</span>
        </span>
      </div>

      <div className="max-h-80 min-h-44 space-y-3 overflow-y-auto bg-[var(--gray-50)] px-4 py-4" aria-live="polite">
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
        {!loading && !loadError ? messages.map((message) => (
          <article key={message.id} className={`flex ${message.is_from_recipient ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[86%] rounded-xl px-3 py-2 ${message.is_from_recipient ? "border border-[var(--gray-200)] bg-[var(--color-background-primary)]" : "bg-[var(--color-brand-600)] text-white"}`}>
              <p className={`text-[11px] font-semibold ${message.is_from_recipient ? "text-[var(--color-text-secondary)]" : "text-white/75"}`}>{message.is_from_recipient ? message.sender_name : "Mingla team"}</p>
              <p className={`mt-0.5 whitespace-pre-wrap break-words text-sm ${message.is_from_recipient ? "text-[var(--color-text-primary)]" : "text-white"}`}>{message.content}</p>
              <p className={`mt-1 text-[10px] ${message.is_from_recipient ? "text-[var(--color-text-tertiary)]" : "text-white/65"}`}>{shortDateTime(message.created_at)}</p>
            </div>
          </article>
        )) : null}
      </div>

      <form className="space-y-2 border-t border-[var(--gray-200)] p-3" onSubmit={(event) => void submit(event)}>
        <Textarea
          aria-label={`Message ${name}`}
          placeholder="Write a clear update or question"
          className="min-h-20 font-sans"
          value={draft}
          maxLength={4000}
          disabled={loading || Boolean(loadError)}
          onChange={updateDraft}
          error={sendError || undefined}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--color-text-tertiary)]">{draft.trim().length}/4000</span>
          <Button type="submit" size="sm" icon={Send} loading={sending} disabled={!draft.trim() || loading || Boolean(loadError)}>Send to Chats</Button>
        </div>
      </form>
    </section>
  );
}
