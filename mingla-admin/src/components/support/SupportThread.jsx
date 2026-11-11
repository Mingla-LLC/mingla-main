// #4382 Wave 2 — a ticket's thread: replies, internal notes (yellow, dashed,
// labelled), inline images that open full size, and Explorer voice notes.
// Files are shown only through one-hour signed links.
import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { PhotoLightbox } from "../ui/PhotoLightbox";
import { timeAgo } from "../../lib/formatters";
import { formatVoiceLength } from "../../lib/supportTicketMetrics";

export function VoiceNotePlayer({ url, durationMs }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [failed, setFailed] = useState(false);
  const total = Number(durationMs || 0);

  useEffect(() => () => audioRef.current?.pause(), []);

  if (!url) {
    return <p className="text-xs text-[var(--color-text-tertiary)]">Voice note · {formatVoiceLength(total)} · still being moved into Support</p>;
  }

  async function toggle() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
        setFailed(false);
      } catch {
        setFailed(true);
      }
    } else {
      audio.pause();
    }
  }

  const fraction = total > 0 ? Math.min(1, position / total) : 0;
  return (
    <div className="mt-2 flex items-center gap-2 rounded-xl border border-[var(--gray-200)] bg-[var(--color-background-primary)] px-2 py-1.5">
      <audio
        ref={audioRef}
        src={url}
        preload="none"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPosition(0); }}
        onTimeUpdate={(event) => setPosition(event.currentTarget.currentTime * 1000)}
        onError={() => setFailed(true)}
      />
      <button
        type="button"
        onClick={() => void toggle()}
        aria-label={playing ? "Pause voice note" : "Play voice note"}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--color-brand-500)] text-white hover:bg-[var(--color-brand-600)]"
      >
        {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
      </button>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--gray-200)]" aria-hidden="true">
        <div className="h-full bg-[var(--color-brand-500)]" style={{ width: `${fraction * 100}%` }} />
      </div>
      <span className="font-mono text-xs text-[var(--color-text-secondary)]">
        {formatVoiceLength(playing || position ? position : total)}
      </span>
      {failed && <span role="alert" className="text-xs text-[var(--color-error-700)]">Couldn't play</span>}
    </div>
  );
}

function senderLabel(message, profilesById, myUserId) {
  if (message.sender_id && message.sender_id === myUserId) return "You";
  const profile = message.sender_id ? profilesById[message.sender_id] : null;
  return message.sender_display_name_snapshot
    || profile?.display_name
    || profile?.username
    || (message.sender_role_snapshot === "Mingla Support" ? "Mingla Support" : "Customer");
}

/**
 * messages: [{ ...message, attachments: [...] }]; urls: { [storage_path]: signedUrl }.
 */
export function SupportThread({ ticket, messages, urls, profilesById, myUserId }) {
  const [viewer, setViewer] = useState(null);
  const images = messages.flatMap((message) => message.attachments.filter((a) => a.kind === "image" && urls[a.storage_path]));
  const imageIndex = new Map(images.map((attachment, index) => [attachment.id, index]));

  if (messages.length === 0) {
    return <p className="py-8 text-center text-sm text-[var(--color-text-tertiary)]">No messages yet in this ticket.</p>;
  }

  return (
    <div className="space-y-3">
      {ticket.imported_from === "beta_feedback" && (
        <p className="text-center text-xs italic text-[var(--color-text-tertiary)]">Moved from beta feedback. Nobody was messaged.</p>
      )}
      {messages.map((message) => {
        if (message.message_type === "system" || !message.sender_id && !message.sender_display_name_snapshot) {
          return <p key={message.id} className="text-center text-xs italic text-[var(--color-text-tertiary)]">{message.content}</p>;
        }
        const staff = message.sender_role_snapshot === "Mingla Support";
        const note = message.is_internal;
        const who = senderLabel(message, profilesById, myUserId);
        const imageAttachments = message.attachments.filter((a) => a.kind === "image");
        const voice = message.attachments.filter((a) => a.kind === "audio");
        return (
          <div key={message.id} className={`flex flex-col ${staff && !note ? "items-end" : "items-start"}`}>
            <span className="mb-0.5 text-[11px] font-medium text-[var(--color-text-tertiary)]">
              {note ? `Internal note · ${who} · only staff can see this` : staff ? `${who} · Mingla` : who} · {timeAgo(message.created_at)}
            </span>
            <div
              className={[
                "max-w-[88%] rounded-2xl px-3 py-2 text-sm",
                note
                  ? "w-full border-2 border-dashed border-[#d4a72c] bg-[#fff8db] text-[#5c4813]"
                  : staff
                    ? "bg-[var(--color-brand-500)] text-white"
                    : "bg-[var(--gray-100)] text-[var(--color-text-primary)]",
              ].join(" ")}
            >
              {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
              {imageAttachments.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {imageAttachments.map((attachment) => (
                    urls[attachment.storage_path] ? (
                      <button
                        key={attachment.id}
                        type="button"
                        onClick={() => setViewer(imageIndex.get(attachment.id) ?? 0)}
                        aria-label="Open image full size"
                        className="h-20 w-20 overflow-hidden rounded-lg border border-black/10 bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-500)]"
                      >
                        <img src={urls[attachment.storage_path]} alt="" loading="lazy" className="h-full w-full object-cover" />
                      </button>
                    ) : (
                      <span key={attachment.id} className="flex h-20 w-20 items-center justify-center rounded-lg border border-dashed border-black/20 p-1 text-center text-[10px]">
                        {attachment.import_source_path && !attachment.import_copied_at ? "Still being moved" : "Couldn't open"}
                      </span>
                    )
                  ))}
                </div>
              )}
              {voice.map((attachment) => (
                <VoiceNotePlayer key={attachment.id} url={urls[attachment.storage_path]} durationMs={attachment.duration_ms} />
              ))}
            </div>
          </div>
        );
      })}
      {viewer !== null && images.length > 0 && (
        <PhotoLightbox photos={images.map((attachment) => urls[attachment.storage_path])} startIndex={viewer} onClose={() => setViewer(null)} />
      )}
    </div>
  );
}
