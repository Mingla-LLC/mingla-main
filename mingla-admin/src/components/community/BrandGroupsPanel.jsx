import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import { useToast } from "../../context/ToastContext";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { SectionCard } from "../ui/Card";
import { Spinner } from "../ui/Spinner";
import { ProductSignalModal } from "./SupportWorkflowModals";
import {
  listOfficialBrandGroups,
  listOfficialBrandGroupMessages,
  markOfficialBrandGroupRead,
  sendOfficialBrandGroupMessage,
  setOfficialBrandGroupWatch,
} from "../../services/communityService";
import { listProductSignals } from "../../services/supportProductWorkflowService";
import { timeAgo } from "../../lib/formatters";

export function BrandGroupsPanel() {
  const { session } = useAuth();
  const { addToast } = useToast();
  const myUserId = session?.user?.id ?? null;
  const mounted = useRef(true);
  const [groups, setGroups] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [error, setError] = useState("");
  const [composer, setComposer] = useState("");
  const [sending, setSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [selectedMessageIds, setSelectedMessageIds] = useState([]);
  const [signalSource, setSignalSource] = useState(null);
  const [signals, setSignals] = useState([]);

  useEffect(() => () => { mounted.current = false; }, []);

  const loadGroups = useCallback(async () => {
    try {
      const rows = await listOfficialBrandGroups();
      if (!mounted.current) return;
      setGroups(rows);
      setSelectedId((current) => current && rows.some((row) => row.conversation_id === current)
        ? current
        : rows[0]?.conversation_id ?? null);
      setError("");
    } catch (cause) {
      if (mounted.current) setError(cause?.message || "Couldn't load Brand groups");
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  const loadThread = useCallback(async (conversationId) => {
    if (!conversationId) return;
    setThreadLoading(true);
    try {
      const [rows, productSignals] = await Promise.all([
        listOfficialBrandGroupMessages(conversationId),
        listProductSignals(),
      ]);
      if (!mounted.current) return;
      setMessages(rows);
      setSignals(productSignals);
      await markOfficialBrandGroupRead(conversationId);
      await loadGroups();
    } catch (cause) {
      if (mounted.current) addToast({ variant: "error", title: "Couldn't load the Brand group", description: cause?.message });
    } finally {
      if (mounted.current) setThreadLoading(false);
    }
  }, [addToast, loadGroups]);

  useEffect(() => { void loadGroups(); }, [loadGroups]);
  useEffect(() => {
    setReplyTo(null);
    setSelectedMessageIds([]);
    setComposer("");
    setMessages([]);
    if (selectedId) void loadThread(selectedId);
  }, [loadThread, selectedId]);

  useEffect(() => {
    const channel = supabase
      .channel("admin-brand-groups")
      .on("postgres_changes", { event: "*", schema: "public", table: "messages" }, (event) => {
        void loadGroups();
        if (selectedId && event.new?.conversation_id === selectedId) void loadThread(selectedId);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "brand_group_reads" }, () => {
        void loadGroups();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [loadGroups, loadThread, selectedId]);

  const selectedGroup = groups.find((group) => group.conversation_id === selectedId) ?? null;
  const selectedMessages = useMemo(
    () => messages.filter((message) => selectedMessageIds.includes(message.id)),
    [messages, selectedMessageIds],
  );

  async function send() {
    const content = composer.trim();
    if (!selectedId || !content || sending) return;
    setSending(true);
    try {
      await sendOfficialBrandGroupMessage({
        conversationId: selectedId,
        content,
        replyToId: replyTo?.id ?? null,
        relatedMessageIds: selectedMessageIds,
      });
      setComposer("");
      setReplyTo(null);
      setSelectedMessageIds([]);
      await loadThread(selectedId);
    } catch (cause) {
      addToast({ variant: "error", title: "Message not sent", description: cause?.message });
    } finally {
      setSending(false);
    }
  }

  async function toggleWatch() {
    if (!selectedGroup) return;
    try {
      const enabled = await setOfficialBrandGroupWatch(selectedGroup.conversation_id, !selectedGroup.push_enabled);
      setGroups((current) => current.map((group) => group.conversation_id === selectedGroup.conversation_id
        ? { ...group, push_enabled: enabled }
        : group));
      addToast({ variant: "success", title: enabled ? "Watching Brand group" : "Ordinary push is off", description: enabled ? "Replies and watched activity can now reach you by push." : "Unread badges stay active." });
    } catch (cause) {
      addToast({ variant: "error", title: "Couldn't update notifications", description: cause?.message });
    }
  }

  function toggleSelected(id) {
    setSelectedMessageIds((current) => current.includes(id)
      ? current.filter((messageId) => messageId !== id)
      : [...current, id]);
  }

  function openSignal(message) {
    const evidence = [message, ...selectedMessages.filter((item) => item.id !== message.id)]
      .map((item) => `${item.sender_display_name}: ${item.content}`)
      .join("\n");
    setSignalSource({
      id: message.id,
      source_kind: "brand_group_message",
      subject: `${selectedGroup?.brand_name || "Brand group"}: ${message.content.slice(0, 120)}`,
      details: evidence,
      requester_user_id: message.sender_id,
      priority: "normal",
      next_update_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  }

  if (loading) return <div className="flex min-h-64 items-center justify-center"><Spinner /></div>;
  if (error) return <SectionCard title="Brand groups"><div className="space-y-3 text-sm text-[var(--color-text-secondary)]"><p>{error}</p><Button variant="secondary" onClick={() => void loadGroups()}>Retry</Button></div></SectionCard>;

  return (
    <div className="grid min-h-[620px] gap-4 xl:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
      <SectionCard title="Official Brand groups" subtitle={`${groups.length} active`} noPadding>
        <div className="max-h-[700px] overflow-y-auto divide-y divide-[var(--gray-200)]">
          {groups.length === 0 ? <p className="p-5 text-sm text-[var(--color-text-secondary)]">Active Host brands will appear here automatically.</p> : groups.map((group) => (
            <button
              key={group.conversation_id}
              type="button"
              onClick={() => setSelectedId(group.conversation_id)}
              className={`w-full min-h-16 px-4 py-3 text-left transition-colors ${selectedId === group.conversation_id ? "bg-[var(--color-brand-50)]" : "hover:bg-[var(--gray-50)]"}`}
            >
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{group.brand_name}</span>
                {group.unread_count > 0 ? <Badge variant="brand">{group.unread_count}</Badge> : null}
              </div>
              <p className="mt-1 truncate text-xs text-[var(--color-text-tertiary)]">{group.last_message_preview || `${group.member_count} brand teammates`}</p>
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title={selectedGroup?.brand_name || "Choose a Brand group"}
        subtitle={selectedGroup ? `${selectedGroup.member_count} brand teammates · Support has access` : ""}
        action={selectedGroup ? <Button variant="secondary" size="sm" onClick={() => void toggleWatch()}>{selectedGroup.push_enabled ? "Watching" : "Watch"}</Button> : null}
        noPadding
      >
        {!selectedGroup ? <div className="flex min-h-64 items-center justify-center p-6 text-sm text-[var(--color-text-secondary)]">Select a Brand group to read and reply.</div> : (
          <div className="flex min-h-[620px] flex-col">
            <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
              {threadLoading && messages.length === 0 ? <div className="flex min-h-48 items-center justify-center"><Spinner /></div> : null}
              {!threadLoading && messages.length === 0 ? <p className="rounded-xl border border-[var(--gray-200)] p-5 text-sm text-[var(--color-text-secondary)]">This is the official Brand group. Start the first conversation here.</p> : null}
              {messages.map((message) => {
                const mine = message.sender_id === myUserId;
                const selected = selectedMessageIds.includes(message.id);
                return (
                  <div key={message.id} className={`flex flex-col ${mine ? "items-end" : "items-start"}`}>
                    {!mine ? <span className="mb-1 px-2 text-[11px] font-medium text-[var(--color-text-tertiary)]">{message.sender_display_name}{message.sender_role === "Mingla Support" ? " · Mingla Support" : ""}</span> : null}
                    <div className={`max-w-[85%] rounded-2xl border px-3 py-2 text-sm ${mine ? "border-[var(--color-brand-500)] bg-[var(--color-brand-500)] text-white" : "border-[var(--gray-200)] bg-[var(--gray-100)] text-[var(--color-text-primary)]"} ${selected ? "ring-2 ring-[#8b5cf6]" : ""}`}>
                      {message.reply_content ? <blockquote className="mb-2 border-l-2 border-current pl-2 text-xs opacity-75"><strong>{message.reply_sender_display_name || "Message"}</strong><br />{message.reply_content}</blockquote> : null}
                      <p className="whitespace-pre-wrap break-words">{message.content}</p>
                      <p className="mt-1 text-[10px] opacity-65">{timeAgo(message.created_at)}</p>
                    </div>
                    <div className={`mt-1 flex flex-wrap gap-3 px-2 text-xs ${mine ? "justify-end" : "justify-start"}`}>
                      <button type="button" className="font-medium text-[var(--color-brand-600)] hover:underline" onClick={() => setReplyTo(message)}>Reply</button>
                      <button type="button" className="font-medium text-[var(--color-brand-600)] hover:underline" onClick={() => toggleSelected(message.id)}>{selected ? "Unselect" : "Select"}</button>
                      <button type="button" className="font-medium text-[var(--color-brand-600)] hover:underline" onClick={() => openSignal(message)}>Create product signal</button>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-2 border-t border-[var(--gray-200)] p-3 sm:p-4">
              {replyTo ? <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--gray-100)] px-3 py-2 text-xs"><div className="min-w-0"><strong>Replying to {replyTo.sender_display_name}</strong><p className="truncate text-[var(--color-text-tertiary)]">{replyTo.content}</p></div><button type="button" className="font-semibold text-[var(--color-brand-600)]" onClick={() => setReplyTo(null)}>Clear</button></div> : null}
              {selectedMessages.length ? <p className="text-xs font-medium text-[#7c3aed]">{selectedMessages.length} related message{selectedMessages.length === 1 ? "" : "s"} selected</p> : null}
              <p className="text-[11px] text-[var(--color-text-tertiary)]">Replying as your real staff name · Mingla Support</p>
              <div className="flex items-end gap-2">
                <textarea
                  value={composer}
                  onChange={(event) => setComposer(event.target.value)}
                  rows={2}
                  placeholder="Reply to the Brand group…"
                  className="min-h-11 flex-1 resize-y rounded-xl border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-[var(--color-brand-500)] focus:ring-2 focus:ring-[var(--color-brand-100)]"
                />
                <Button loading={sending} disabled={sending || !composer.trim()} onClick={() => void send()}>Send</Button>
              </div>
            </div>
          </div>
        )}
      </SectionCard>

      <ProductSignalModal
        source={signalSource}
        signals={signals}
        onClose={() => setSignalSource(null)}
        onCreated={async () => {
          setSignals(await listProductSignals());
          setSelectedMessageIds([]);
          addToast({ variant: "success", title: "Private Product signal created" });
        }}
        onLinked={async () => {
          setSignals(await listProductSignals());
          setSelectedMessageIds([]);
          addToast({ variant: "success", title: "Brand group report linked" });
        }}
        onError={(cause) => addToast({ variant: "error", title: "Couldn't save the Product signal", description: cause?.message })}
      />
    </div>
  );
}

export default BrandGroupsPanel;
