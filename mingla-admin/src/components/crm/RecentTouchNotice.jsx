// Issue #3980 — on a host or creator card: when Mingla messaged them in the
// last 3 days (agents cannot write again until then, unless a person allows
// one more), and which agent has claimed the card right now.
import { useCallback, useEffect, useState } from "react";
import { AlertCard } from "../ui/Card";
import { Button } from "../ui/Button";
import { useToast } from "../../context/ToastContext";
import * as ops from "../../services/opsService";
import { agentName, dayLabel, opsErrorWords, timeLabel } from "../../lib/opsModel";

const CHANNELS = { email: "email", whatsapp: "WhatsApp", instagram_dm: "Instagram DM", tiktok_dm: "TikTok DM", phone: "phone", in_person: "in person" };

export function RecentTouchNotice({ record, online }) {
  const { addToast } = useToast();
  const [signals, setSignals] = useState(null);
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const id = record?.id;
  const load = useCallback(async () => {
    if (!id) return;
    try { setSignals(await ops.fetchRecordSignals(id)); }
    catch { setSignals(null); }
  }, [id]);
  useEffect(() => { setSignals(null); setAsking(false); setReason(""); load(); }, [load]);

  const touch = signals?.recent_touch;
  const claim = signals?.claim;
  if (!touch?.within_days && !claim) return null;
  const allowedUntil = touch?.override_until;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {touch?.within_days && (
        <AlertCard
          variant="info"
          action={allowedUntil ? null : asking ? (
            <div className="flex min-w-0 flex-wrap items-end gap-2">
              <label className="flex min-w-[200px] flex-1 flex-col gap-1">
                <span className="text-xs font-semibold text-[var(--color-info-700)]">Why can it not wait?</span>
                <input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} className="min-h-11 w-full rounded-lg border border-[var(--gray-300)] bg-[var(--color-background-primary)] px-3 text-sm text-[var(--color-text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-brand-700)]" />
              </label>
              <Button className="min-h-11" disabled={!online || busy || reason.trim().length < 5} onClick={async () => {
                setBusy(true);
                try { await ops.allowOneMore(id, reason.trim()); addToast({ variant: "success", title: "Allowed for 24 hours." }); setAsking(false); setReason(""); await load(); }
                catch (error) { addToast({ variant: "error", title: "Not allowed", description: opsErrorWords(error) }); }
                finally { setBusy(false); }
              }}>Allow</Button>
              <Button variant="ghost" className="min-h-11" onClick={() => setAsking(false)}>Cancel</Button>
            </div>
          ) : (
            <Button variant="secondary" className="min-h-11" disabled={!online} onClick={() => setAsking(true)}>Allow one more message</Button>
          )}
        >
          Mingla messaged them {touch.days_ago === 0 ? "today" : `${touch.days_ago} ${touch.days_ago === 1 ? "day" : "days"} ago`} by {CHANNELS[touch.channel] || "message"}. {allowedUntil ? `One more message is allowed until ${dayLabel(allowedUntil)} ${timeLabel(allowedUntil)}.` : `Agents cannot write another message until ${dayLabel(touch.clear_on)}.`}
        </AlertCard>
      )}
      {claim && <AlertCard variant="info">{agentName(claim.holder_name, claim.holder_via)} has claimed this card since {timeLabel(claim.since)}.</AlertCard>}
    </div>
  );
}
