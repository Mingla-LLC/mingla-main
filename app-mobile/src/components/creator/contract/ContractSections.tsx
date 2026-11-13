import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { gigZone, type GigProposal, type GigTerms, type GigWorkspace } from '../../../services/creatorGigsService';
import { chooseAndUploadCreatorMedia, isPickerCancel, pendingDeliveryMedia, waitForMediaReady } from '../../../services/creatorMediaService';
import { programErrorText, toProgramError } from '../../../services/programResult';
import { agreedVideoDue, agreedVideoDueZoned, deliverablesLabel, doorPassLine, formatDateRange, formatDateTime, formatInZone, formatMoney, formatShortDate, parseDay, platformLabel, postDeadlineText, proposalDueText, salesShareText, shootPickRange, uploadDueReason, usageLabel, videoDueText } from '../../../utils/programFormat';
import { PROGRAM_COLORS as C, ProgramButton, ProgramCard, ProgramField, ProgramNotice, ProgramPill, ProgramRow, ProgramSheet, programStyles as s } from '../../programs/ProgramUi';
import { CalendarGrid, CheckRow, Chip, StarsInput, TimeChips } from '../../programs/ProgramPickers';
import { playOwnVideo } from '../../programs/VideoTile';
import { POST_URL_RULES, TRACK_STEPS, TRACK_TITLES, actorWords, currentTrackStep, eventWords, failedPostReason, fixWords, postCheckWords, scriptPartsFor, type ScriptPartSpec } from './contractWords';

// ── Brand (revealed after acceptance) ──────────────────────────────────────

export function BrandCard({ workspace }: { workspace: GigWorkspace }): React.ReactElement | null {
  if (!workspace.revealed) return null;
  const g = workspace.gig;
  const reveal = workspace.reveal ?? null;
  const name = (reveal?.brand_name ?? g.brand_name)?.trim() || 'Your host';
  const place = [reveal?.place_name ?? g.place_name, reveal?.place_address ?? g.place_address].filter(Boolean).join(' · ');
  // The server stores must-tag as an object ({disclosure, mingla}); older rows may be a list.
  const rawTags: unknown = g.must_tag;
  const tags = (Array.isArray(rawTags) ? rawTags : rawTags && typeof rawTags === 'object' ? Object.values(rawTags) : [])
    .filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0);
  return <ProgramCard>
    <View style={styles.brandTop}>
      <View style={styles.avatar}><Text style={styles.avatarText}>{name.slice(0, 2).toUpperCase()}</Text></View>
      <View style={s.flex}>
        <Text style={s.title} numberOfLines={1}>{name}</Text>
        {place ? <Text style={s.copy} numberOfLines={2}>{place}</Text> : null}
      </View>
    </View>
    {g.brief_private?.trim() ? <>
      <Text style={s.label}>Private brief</Text>
      <Text style={s.strong}>{g.brief_private}</Text>
    </> : null}
    {tags.length ? <>
      <Text style={s.label}>Must tag</Text>
      <View style={s.wrap}>{tags.map((t) => <ProgramPill key={t} label={t} tone="accent" />)}</View>
    </> : null}
  </ProgramCard>;
}

// ── Tracker ────────────────────────────────────────────────────────────────

export function Tracker({ state, terms, acceptedAt, releaseHint }: { state: string; terms: GigTerms | null; acceptedAt: string | null; releaseHint: string }): React.ReactElement {
  const current = currentTrackStep(state);
  const index = TRACK_STEPS.indexOf(current);
  const allDone = ['released', 'day30', 'completed', 'resolved_release'].includes(state);
  return <ProgramCard>
    {TRACK_STEPS.map((step, i) => {
      const done = allDone || i < index;
      const now = !allDone && i === index;
      const sub = step === 'accepted' && acceptedAt && terms ? `${formatShortDate(acceptedAt)} · ${formatMoney(terms.fee_minor, terms.currency)} held by Mingla`
        : step === 'paid' ? releaseHint : null;
      return <View key={step} style={styles.trackRow} accessibilityLabel={`${TRACK_TITLES[step]}${done ? ', done' : now ? ', now' : ''}`}>
        <View style={styles.trackRail}>
          <View style={[styles.dot, done && styles.dotDone, now && styles.dotNow]} />
          {i < TRACK_STEPS.length - 1 ? <View style={[styles.line, done && styles.lineDone]} /> : null}
        </View>
        <View style={styles.trackText}>
          <Text style={[s.strong, !done && !now && { color: C.faint }]}>{TRACK_TITLES[step]}</Text>
          {sub ? <Text style={s.small}>{sub}</Text> : null}
        </View>
      </View>;
    })}
  </ProgramCard>;
}

// ── Terms and history ──────────────────────────────────────────────────────

export function TermsCard({ terms, gig, zone = null }: { terms: GigTerms; gig: GigWorkspace['gig']; zone?: string | null }): React.ReactElement {
  const window = gig.shoot_window;
  return <ProgramCard>
    <ProgramRow title="Fee" value={formatMoney(terms.fee_minor, terms.currency)} chevron={false} />
    {window ? <ProgramRow title="Shoot" value={formatDateRange(window.start, window.end)} chevron={false} />
      : terms.shoot_date ? <ProgramRow title="Shoot" value={formatShortDate(terms.shoot_date)} chevron={false} /> : null}
    <ProgramRow title="Video due" value={termsVideoDue(terms, gig, zone)} chevron={false} />
    <ProgramRow title="Deliverables" value={deliverablesLabel(terms.deliverables)} chevron={false} />
    <ProgramRow title="Fixes included" value="2 technical" chevron={false} />
    {salesShareText(terms.sales_share_bps) ? <ProgramRow title="Plus" value={salesShareText(terms.sales_share_bps)!} chevron={false} /> : null}
    <ProgramRow title="Marketing rights" value={terms.rights_model === 'creator_v1_perpetual' ? 'Perpetual after full fee release' : usageLabel(terms.usage_days)} chevron={false} isLast />
  </ProgramCard>;
}

/** The agreed due (current terms): date and time. */
function termsVideoDue(terms: GigTerms, gig: GigWorkspace['gig'], zone: string | null): string {
  return agreedVideoDueZoned(terms, gig, zone);
}

export function TermsHistory({ terms }: { terms: GigTerms[] }): React.ReactElement | null {
  if (terms.length < 2) return null;
  return <>
    <Text style={s.label}>Terms history</Text>
    <ProgramCard>
      {terms.slice().reverse().map((t, i) => <ProgramRow key={t.version} title={t.version === 1 ? 'Original terms' : `Updated terms${t.created_at ? ` · ${formatShortDate(t.created_at)}` : ''}`}
        subtitle={`Video due ${videoDueText(t.video_due_at ?? null, t.post_by ?? null)} · ${deliverablesLabel(t.deliverables)}`} value={formatMoney(t.fee_minor, t.currency)} chevron={false} isLast={i === terms.length - 1} />)}
    </ProgramCard>
  </>;
}

/** A change the host proposed (accept / decline) or yours that's waiting. */
export function ProposalCard({ proposal, currency, busy, onRespond }: { proposal: GigProposal; currency: string; busy: boolean; onRespond: (accept: boolean) => void }): React.ReactElement {
  const due = proposalDueText(proposal.changes);
  const lines = Object.entries(proposal.changes).filter(([key]) => key !== 'post_by' && key !== 'video_due_at').map(([key, value]) => {
    if (key === 'shoot_date') return `Shoot on ${formatShortDate(String(value))}`;
    if (key === 'usage_days') return `Legacy reuse period: ${usageLabel(Number(value))}`;
    if (key === 'fee_minor') return `Fee ${formatMoney(Number(value), currency)}`;
    if (key === 'sales_share_bps') return `${Math.round(Number(value) / 100)}% of sales`;
    if (key === 'deliverables' && Array.isArray(value)) return deliverablesLabel(value as Array<{ platform: string; kind: string; count: number }>);
    if (key === 'shoot_passes') return `${Number(value)} door pass${Number(value) === 1 ? '' : 'es'}`;
    return 'Other change';
  });
  if (due) lines.unshift(due);
  const fromHost = proposal.proposed_by === 'host';
  return <ProgramCard tone="highlight">
    <Text style={s.label}>{fromHost ? 'The host proposed a change' : 'Your proposed change'}</Text>
    {lines.map((l) => <Text key={l} style={s.strong}>{l}</Text>)}
    {proposal.note ? <Text style={s.copy}>“{proposal.note}”</Text> : null}
    {fromHost ? <View style={styles.two}>
      <ProgramButton label="Decline" variant="secondary" style={s.flex} disabled={busy} onPress={() => onRespond(false)} />
      <ProgramButton label="Accept" style={s.flex} busy={busy} onPress={() => onRespond(true)} />
    </View> : <Text style={s.small}>Waiting for the host · answer by {formatDateTime(proposal.expires_at)}</Text>}
  </ProgramCard>;
}

// ── Timeline ───────────────────────────────────────────────────────────────

export function Timeline({ events }: { events: GigWorkspace['events'] }): React.ReactElement {
  const shown = events.slice().reverse().slice(0, 30);
  return <>
    <Text style={s.label}>Timeline</Text>
    <ProgramCard>
      {shown.length === 0 ? <Text style={s.copy}>No activity yet.</Text> : shown.map((e, i) => <View key={e.id} style={[styles.event, i < shown.length - 1 && styles.eventBorder]}>
        <Text style={s.strong}>{eventWords(e.kind, e.data, formatMoney)}</Text>
        <Text style={s.small}>{actorWords(e.actor)} · {formatDateTime(e.at)}</Text>
      </View>)}
    </ProgramCard>
  </>;
}

// ── Confirmed shoot + text door pass ───────────────────────────────────────

const SHOOT_CARD_STATES = ['shoot_planned', 'script_drafting', 'script_sent', 'script_locked', 'delivered', 'fix_requested'];

/** The agreed shoot time, where to arrive and the door pass, from the confirmed plan until the video is approved. */
export function ShootCard({ workspace, state, creatorName = null }: { workspace: GigWorkspace; state: string; creatorName?: string | null }): React.ReactElement | null {
  const plan = workspace.shoot_plan;
  if (!plan?.confirmed_at || !plan.shoot_at || !SHOOT_CARD_STATES.includes(state)) return null;
  const terms = workspace.terms.find((t) => t.version === workspace.contract.current_terms_version) ?? workspace.terms[workspace.terms.length - 1];
  const reveal = workspace.reveal ?? null;
  const place = [reveal?.place_name ?? workspace.gig.place_name, reveal?.place_address ?? workspace.gig.place_address].filter(Boolean).join(' · ');
  const arrival = typeof plan.arrival_note === 'string' ? plan.arrival_note.trim() : '';
  return <ProgramCard accessibilityLabel="Shoot and door pass">
    <ProgramPill label="Shoot confirmed" tone="success" />
    <Text style={s.title}>Shoot: {formatInZone(String(plan.shoot_at), gigZone(workspace))}</Text>
    {place ? <Text style={s.copy}>{place}</Text> : null}
    {arrival ? <Text style={s.copy}>Arrival: {arrival}</Text> : null}
    <Text style={s.label}>Door pass</Text>
    <Text style={s.strong}>{doorPassLine(terms?.shoot_passes, creatorName)}</Text>
    <Text style={s.small}>Show this screen at the door.</Text>
  </ProgramCard>;
}

// ── Shoot ──────────────────────────────────────────────────────────────────

export function ShootSheet({ visible, onClose, window, initialAt, busy, error, onSend }: {
  visible: boolean; onClose: () => void; window: { start: string; end: string } | null; initialAt: string | null; busy: boolean; error: string | null;
  onSend: (iso: string, note: string) => void;
}): React.ReactElement {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the window object is rebuilt each render; its days are what matter.
  const range = useMemo(() => shootPickRange(window, initialAt), [window?.start, window?.end, initialAt]);
  const initial = parseDay(initialAt);
  const [day, setDay] = useState<string | null>(range.initialDay);
  const [time, setTime] = useState<string | null>(initial ? `${String(initial.getHours()).padStart(2, '0')}:${String(initial.getMinutes()).padStart(2, '0')}` : '19:00');
  const [note, setNote] = useState('');
  // Opening the sheet (or the window arriving) starts on a day that can be picked.
  useEffect(() => {
    if (!visible) return;
    setDay((current) => (current && current >= range.minDate && (!range.maxDate || current <= range.maxDate) ? current : range.initialDay));
  }, [visible, range.minDate, range.maxDate, range.initialDay]);
  const at = useMemo(() => {
    if (!day || !time) return null;
    const d = parseDay(day)!;
    const [h, m] = time.split(':').map(Number);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m);
  }, [day, time]);
  return <ProgramSheet visible={visible} onClose={onClose} title="Pick a time" snapPoints={['90%']} busy={busy}
    footer={<View style={styles.footerStack}>
      {error ? <ProgramNotice tone="error" text={error} /> : null}
      <ProgramButton label={at ? `Send ${formatDateTime(at)}` : 'Pick a day and time'} busy={busy} disabled={!at} onPress={() => at && onSend(at.toISOString(), note)} />
    </View>}>
    {window ? <Text style={s.copy}>Shoot window {formatDateRange(window.start, window.end)}</Text> : null}
    {/* Remount on a new range so the month shown is the window's first month. */}
    <CalendarGrid key={`${range.minDate}:${range.maxDate ?? ''}`} start={day} onPick={setDay} minDate={range.minDate} maxDate={range.maxDate} />
    <TimeChips value={time} onChange={setTime} options={['12:00', '15:00', '17:00', '18:00', '19:00', '20:00', '21:00']} />
    <ProgramField inSheet label="Arrival note for the host (optional)" value={note} onChangeText={setNote} placeholder="e.g. Bringing one friend for B-roll" maxLength={500} multiline counter={{ max: 500 }} />
  </ProgramSheet>;
}

// ── Script ─────────────────────────────────────────────────────────────────

type ScriptPart = { on_screen: string; voiceover: string };

export function ScriptEditor({ workspace, editable, busy, error, onSave }: {
  workspace: GigWorkspace; editable: boolean; busy: boolean; error: string | null;
  onSave: (body: Record<string, unknown>, send: boolean) => void;
}): React.ReactElement {
  const latest = workspace.scripts[workspace.scripts.length - 1];
  // The parts follow the gig format's beats (Hook, Atmosphere, Experience, End card).
  const specs: ScriptPartSpec[] = useMemo(() => scriptPartsFor(workspace.gig.format_structure), [workspace.gig.format_structure]);
  const initialParts = useMemo(() => {
    const parts: Record<string, ScriptPart> = Object.fromEntries(specs.map((p) => [p.key, { on_screen: '', voiceover: '' }]));
    (latest?.body?.sections ?? []).forEach((section, i) => {
      const key = typeof section.key === 'string' && section.key in parts ? section.key : specs[i]?.key;
      if (key) parts[key] = { on_screen: String(section.on_screen ?? ''), voiceover: String(section.voiceover ?? '') };
    });
    return parts;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a refetch of the same script must not wipe what is being typed.
  }, [latest?.version, specs]);
  const [parts, setParts] = useState(initialParts);
  const [disclosure, setDisclosure] = useState<string>(typeof latest?.body?.disclosure === 'string' && latest.body.disclosure ? latest.body.disclosure : '#ad');
  const [confirmed, setConfirmed] = useState(Boolean(latest));
  useEffect(() => { setParts(initialParts); }, [initialParts]);

  const filled = specs.filter((p) => ((parts[p.key]?.on_screen ?? '') + (parts[p.key]?.voiceover ?? '')).trim().length > 0).length;
  const body = (): Record<string, unknown> => ({
    sections: specs.map((p) => ({ key: p.key, on_screen: (parts[p.key]?.on_screen ?? '').trim(), voiceover: (parts[p.key]?.voiceover ?? '').trim(), shot_notes: '' })),
    disclosure, estimated_seconds: 30,
  });

  if (!editable) {
    return <ProgramCard>
      <Text style={s.label}>{latest?.locked_at ? 'Locked script' : 'Your script'}</Text>
      {specs.map((p) => (parts[p.key]?.on_screen || parts[p.key]?.voiceover) ? <View key={p.key} style={styles.part}>
        <Text style={s.strong}>{p.title}</Text>
        {parts[p.key].on_screen ? <Text style={s.copy}>On screen: {parts[p.key].on_screen}</Text> : null}
        {parts[p.key].voiceover ? <Text style={s.copy}>Say: {parts[p.key].voiceover}</Text> : null}
      </View> : null)}
      <Text style={s.small}>Disclosure: {disclosure}</Text>
    </ProgramCard>;
  }

  return <ProgramCard>
    <Text style={s.title}>Script</Text>
    {specs.map((p) => <View key={p.key} style={styles.part}>
      <Text style={s.strong}>{p.title}</Text>
      <ProgramField label="On screen" value={parts[p.key]?.on_screen ?? ''} onChangeText={(v) => setParts((cur) => ({ ...cur, [p.key]: { ...(cur[p.key] ?? { on_screen: '', voiceover: '' }), on_screen: v } }))} placeholder={p.placeholder} multiline maxLength={400} />
      <ProgramField label="What you say" value={parts[p.key]?.voiceover ?? ''} onChangeText={(v) => setParts((cur) => ({ ...cur, [p.key]: { ...(cur[p.key] ?? { on_screen: '', voiceover: '' }), voiceover: v } }))} placeholder="Voiceover or lines" multiline maxLength={400} />
    </View>)}
    <Text style={s.fieldLabel}>Disclosure</Text>
    <View style={s.wrap}>{['#ad', 'Paid partnership'].map((d) => <Chip key={d} label={d} selected={disclosure === d} onPress={() => setDisclosure(d)} />)}</View>
    <CheckRow checked={confirmed} onToggle={() => setConfirmed((v) => !v)} label={`I’ll show ${disclosure} in the post`} hint="Viewers must be able to tell it’s sponsored." />
    {error ? <ProgramNotice tone="error" text={error} /> : null}
    <View style={styles.two}>
      <ProgramButton label="Save draft" variant="secondary" style={s.flex} disabled={busy || filled === 0} onPress={() => onSave(body(), false)} />
      <ProgramButton label="Send to host" style={s.flex} busy={busy} disabled={filled === 0 || !confirmed} onPress={() => onSave(body(), true)} />
    </View>
  </ProgramCard>;
}

// ── Upload ─────────────────────────────────────────────────────────────────

/** What the upload card is doing. `idle` has no progress bar; nothing says "Uploading" before a video is picked. */
export type UploadPhase = 'idle' | 'uploading' | 'processing' | 'ready' | 'sending' | 'sent' | 'failed';

export function UploadCard({ contractId, workspace, onSubmit }: { contractId: string; workspace: GigWorkspace; onSubmit: (jobId: string) => Promise<void> }): React.ReactElement {
  const [phase, setPhase] = useState<UploadPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [jobId, setJobId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stalled, setStalled] = useState(false);
  const [recheck, setRecheck] = useState(0);
  // The last-upload read failed: not the same as "nothing pending", so Choose video is not offered.
  const [readFailed, setReadFailed] = useState(false);
  const [reread, setReread] = useState(0);
  const submitted = useRef<string | null>(null);
  const alive = useRef(true);
  const lastFix = workspace.deliveries.filter((d) => d.decision === 'fix_requested').slice(-1)[0];
  const fixing = workspace.contract.state === 'fix_requested';
  const usedJobs = useMemo(() => workspace.deliveries.map((d) => (typeof d.media_job_id === 'string' ? d.media_job_id : '')).filter(Boolean), [workspace.deliveries]);
  const terms = workspace.terms.find((t) => t.version === workspace.contract.current_terms_version) ?? workspace.terms[workspace.terms.length - 1] ?? null;
  const dueReason = uploadDueReason(agreedVideoDue(terms, workspace.gig), gigZone(workspace));
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Resume: a video of this contract that nothing uses yet (still processing, ready, or failed).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let pending: Awaited<ReturnType<typeof pendingDeliveryMedia>>;
      try { pending = await pendingDeliveryMedia(contractId, usedJobs); setReadFailed(false); }
      catch { if (!cancelled) setReadFailed(true); return; }
      if (cancelled || !pending || submitted.current === pending.id) return;
      setJobId(pending.id);
      setPhase(pending.status === 'ready' ? 'ready' : ['failed', 'rejected', 'expired'].includes(pending.status) ? 'failed' : 'processing');
    })();
    return () => { cancelled = true; };
  }, [contractId, usedJobs, reread]);

  /** Sends a ready video once. A video that is not ready yet goes back to Processing; it is never uploaded again. */
  const send = useCallback(async (id: string): Promise<void> => {
    if (submitted.current === id) return;
    submitted.current = id;
    setPhase('sending'); setError(null);
    try {
      await onSubmit(id);
      if (alive.current) setPhase('sent');
    } catch (e) {
      submitted.current = null;
      if (!alive.current) return;
      if (toProgramError(e).code === 'ready_delivery_media_required') { setStalled(false); setPhase('processing'); setError(null); return; }
      setError(programErrorText(e)); setPhase('ready');
    }
  }, [onSubmit]);

  // Processing: check every 4 s for up to 10 minutes, then send the moment it is ready.
  useEffect(() => {
    if (phase !== 'processing' || !jobId) return;
    let cancelled = false;
    setStalled(false);
    void (async () => {
      const result = await waitForMediaReady(jobId, { isCancelled: () => cancelled });
      if (cancelled) return;
      if (result.status === 'ready') void send(jobId);
      else if (result.status === 'failed') setPhase('failed');
      else if (result.status === 'timeout') setStalled(true);
    })();
    return () => { cancelled = true; };
  }, [phase, jobId, send, recheck]);

  const upload = async (): Promise<void> => {
    const before = phase;
    setProgress(0); setError(null); setStalled(false);
    try {
      const media = await chooseAndUploadCreatorMedia({ purpose: 'delivery', contractId, onProgress: setProgress, onPicked: () => { setPhase('uploading'); } });
      setJobId(media.jobId); setPhase('processing');
    } catch (e) {
      if (isPickerCancel(e)) return;
      setPhase(before === 'ready' ? 'ready' : 'idle'); setError(programErrorText(e));
    }
  };

  const chooseLabel = phase === 'failed' ? 'Choose another video' : phase === 'ready' ? 'Choose a different video' : 'Choose video';
  return <ProgramCard tone="highlight">
    <Text style={s.title}>{fixing ? 'Upload the fixed video' : 'Upload your video'}</Text>
    {dueReason ? <Text style={s.accentText}>{dueReason}</Text> : null}
    {fixing && lastFix ? <>
      <Text style={s.label}>What to fix</Text>
      {(lastFix.fix_categories ?? []).map((c) => <Text key={c} style={s.strong}>• {fixWords(c)}</Text>)}
      {lastFix.fix_note ? <Text style={s.copy}>“{lastFix.fix_note}”</Text> : null}
    </> : null}
    {phase === 'idle' && readFailed ? <>
      <ProgramNotice tone="error" text="We couldn’t check your last upload. Pull to refresh or try again." />
      <ProgramButton label="Retry" onPress={() => setReread((n) => n + 1)} />
    </> : null}
    {phase === 'idle' && !readFailed ? <Text style={s.copy}>Vertical, up to 90 seconds and 150 MB. Mingla keeps a private review copy for the host.</Text> : null}
    {phase === 'uploading' ? <>
      <View style={styles.bar}><View style={[styles.fill, { width: `${Math.max(4, Math.round(progress * 100))}%` }]} /></View>
      <Text style={s.small}>Uploading {Math.round(progress * 100)}%. Keep the app open.</Text>
    </> : null}
    {phase === 'processing' ? <>
      <Text style={s.strong}>Processing your video…</Text>
      <Text style={s.small}>This usually takes under a minute. You can leave this screen; we’ll keep it.</Text>
      {stalled ? <>
        <Text style={s.small}>It’s taking longer than usual. Your video is saved.</Text>
        <ProgramButton label="Check again" variant="secondary" onPress={() => setRecheck((n) => n + 1)} />
      </> : null}
    </> : null}
    {phase === 'ready' ? <>
      <Text style={s.copy}>Your video finished processing.</Text>
      <ProgramButton label="Send this video to the host" busy={false} onPress={() => jobId && void send(jobId)} />
      {error ? <ProgramNotice tone="error" text={error} /> : null}
    </> : null}
    {phase === 'sending' ? <ProgramButton label="Sending to the host" busy onPress={() => undefined} /> : null}
    {phase === 'sent' ? <>
      <Text style={s.strong}>✓ Sent to the host</Text>
      <Text style={s.small}>The host reviews it within 3 days. If they don’t answer, it’s approved automatically.</Text>
    </> : null}
    {phase === 'failed' ? <>
      <ProgramNotice tone="error" text="This video couldn’t be processed. Choose another video." />
    </> : null}
    {phase === 'idle' && error ? <ProgramNotice tone="error" text={error} /> : null}
    {(phase === 'idle' && !readFailed) || phase === 'failed' ? <ProgramButton label={chooseLabel} icon="cloud-upload-outline" onPress={() => void upload()} />
      : phase === 'ready' ? <ProgramButton label={chooseLabel} variant="ghost" onPress={() => void upload()} /> : null}
  </ProgramCard>;
}

export function DeliveriesCard({ workspace }: { workspace: GigWorkspace }): React.ReactElement | null {
  if (!workspace.deliveries.length) return null;
  return <ProgramCard>
    <Text style={s.label}>Your videos</Text>
    {workspace.deliveries.map((d, i) => {
      const decision = d.decision === 'approved' || d.decision === 'auto_approved' ? { label: 'Approved', tone: 'success' as const }
        : d.decision === 'fix_requested' ? { label: 'Fix requested', tone: 'warning' as const } : { label: 'With the host', tone: 'neutral' as const };
      const jobId = typeof d.media_job_id === 'string' ? d.media_job_id : null;
      return <ProgramRow key={d.id} icon="videocam" title={d.round === 0 ? 'First cut' : `Fix ${d.round}`} subtitle={d.submitted_at ? `Uploaded ${formatShortDate(d.submitted_at)}` : null}
        right={<ProgramPill label={decision.label} tone={decision.tone} />} onPress={jobId ? () => void playOwnVideo(jobId) : undefined} chevron={false} isLast={i === workspace.deliveries.length - 1} />;
    })}
  </ProgramCard>;
}

// ── Posts ──────────────────────────────────────────────────────────────────

export function PostLinksCard({ workspace, busy, error, onSubmit }: { workspace: GigWorkspace; busy: boolean; error: string | null; onSubmit: (posts: Array<{ platform: string; url: string }>) => void }): React.ReactElement {
  const terms = workspace.terms[workspace.terms.length - 1];
  const platforms = Array.from(new Set((terms?.deliverables ?? []).map((d) => d.platform).filter((p) => p in POST_URL_RULES)));
  const list = platforms.length ? platforms : ['instagram'];
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState(false);
  const invalid = list.filter((p) => urls[p]?.trim() && !POST_URL_RULES[p].pattern.test(urls[p].trim()));
  const ready = list.every((p) => urls[p]?.trim()) && invalid.length === 0;
  const fixing = workspace.contract.state === 'posts_failed';
  const deadline = postDeadlineText(workspace.contract.state_deadline_at, gigZone(workspace));
  return <ProgramCard tone="highlight">
    <Text style={s.title}>{fixing ? 'Submit the fixed link' : 'Add your live links'}</Text>
    <Text style={s.copy}>Paste the public link for each post. Mingla’s team checks them, usually within a day.</Text>
    {list.map((p) => <ProgramField key={p} label={platformLabel(p)} value={urls[p] ?? ''} onChangeText={(v) => setUrls({ ...urls, [p]: v })} onBlur={() => setTouched(true)}
      placeholder={POST_URL_RULES[p].example} autoCapitalize="none" autoCorrect={false} spellCheck={false} keyboardType="url" textContentType="URL"
      error={touched && invalid.includes(p) ? `That doesn’t look like a ${platformLabel(p)} post link. It should look like ${POST_URL_RULES[p].example}` : null} />)}
    {deadline ? <Text style={s.small}>{fixing ? 'Fix by' : 'Post by'} {deadline}</Text> : null}
    {error ? <ProgramNotice tone="error" text={error} /> : null}
    <ProgramButton label={fixing ? 'Submit the fixed link' : 'Submit links'} busy={busy} disabled={!ready} onPress={() => onSubmit(list.map((p) => ({ platform: p, url: urls[p].trim() })))} />
  </ProgramCard>;
}

export function PostsStatus({ workspace }: { workspace: GigWorkspace }): React.ReactElement | null {
  if (!workspace.posts.length) return null;
  const state = workspace.contract.state;
  const failed = workspace.posts.find((p) => p.check_status === 'failed');
  const reason = failed ? failedPostReason(failed, workspace.events) : null;
  return <ProgramCard>
    <Text style={s.label}>Your posts</Text>
    {state === 'posts_submitted' ? <ProgramNotice title="Mingla’s team is checking your links" text="You’re paid 48 hours after they pass. No deadline runs while the posts are being checked." /> : null}
    {state === 'posts_failed' ? <ProgramNotice tone="warning" title="One of your posts needs a fix" text={reason ?? 'Edit the post or the link, then submit the link again.'} /> : null}
    {workspace.posts.map((p, i) => <ProgramRow key={p.id} title={platformLabel(p.platform)} subtitle={`Added ${formatShortDate(p.submitted_at)}`}
      right={<ProgramPill label={postCheckWords(p.check_status)} tone={p.check_status === 'passed' ? 'success' : p.check_status === 'failed' ? 'danger' : 'neutral'} />} chevron={false} isLast={i === workspace.posts.length - 1} />)}
  </ProgramCard>;
}

// ── Dispute + rating ───────────────────────────────────────────────────────

export function DisputeOpenCard({ busy, error, onOpen }: { busy: boolean; error: string | null; onOpen: (statement: string) => void }): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (!open) return <ProgramButton label="Something’s not right? Open a dispute" variant="ghost" onPress={() => setOpen(true)} />;
  return <ProgramCard>
    <Text style={s.title}>Open a dispute</Text>
    <Text style={s.copy}>You and the host will see the same timeline. Mingla steps in if you can’t agree.</Text>
    <ProgramField label="What happened" value={text} onChangeText={setText} multiline counter={{ max: 1000, min: 10 }} maxLength={1000} placeholder="Explain what happened" />
    {error ? <ProgramNotice tone="error" text={error} /> : null}
    <View style={styles.two}>
      <ProgramButton label="Cancel" variant="secondary" style={s.flex} disabled={busy} onPress={() => setOpen(false)} />
      <ProgramButton label="Open dispute" style={s.flex} busy={busy} disabled={text.trim().length < 10} onPress={() => onOpen(text)} />
    </View>
  </ProgramCard>;
}

export function DisputeCard({ workspace, currency, feeMinor, busy, error, onRespond, onOffer }: {
  workspace: GigWorkspace; currency: string; feeMinor: number; busy: boolean; error: string | null;
  onRespond: (offerId: string, accept: boolean) => void; onOffer: (refundBps: number) => void;
}): React.ReactElement | null {
  const [pct, setPct] = useState(50);
  const dispute = workspace.dispute;
  if (!dispute) return null;
  const open = dispute.offers.find((o) => o.status === 'open');
  const refundOf = (bps: number): string => formatMoney(Math.round((feeMinor * bps) / 10000), currency);
  return <ProgramCard tone="warning">
    <Text style={s.title}>In dispute</Text>
    <Text style={s.copy}>“{dispute.statement}”</Text>
    {open ? <View style={{ gap: 8 }}>
      <Text style={s.strong}>{open.offered_by === 'host' ? 'The host offers' : 'You offered'}: {Math.round(open.refund_bps / 100)}% back to the host ({refundOf(open.refund_bps)}); you keep {refundOf(10000 - open.refund_bps)}</Text>
      {open.offered_by === 'host' ? <View style={styles.two}>
        <ProgramButton label="Decline" variant="secondary" style={s.flex} disabled={busy} onPress={() => onRespond(open.id, false)} />
        <ProgramButton label="Accept" style={s.flex} busy={busy} onPress={() => onRespond(open.id, true)} />
      </View> : <Text style={s.small}>Waiting for the host to answer.</Text>}
    </View> : <View style={{ gap: 8 }}>
      <Text style={s.fieldLabel}>Offer a settlement: share back to the host</Text>
      <View style={s.wrap}>{[0, 25, 50, 75, 100].map((n) => <Chip key={n} label={`${n}%`} selected={pct === n} onPress={() => setPct(n)} />)}</View>
      <Text style={s.small}>You keep {refundOf(10000 - pct * 100)}.</Text>
      <ProgramButton label="Send offer" busy={busy} onPress={() => onOffer(pct * 100)} />
    </View>}
    {error ? <ProgramNotice tone="error" text={error} /> : null}
  </ProgramCard>;
}

export function RatingCard({ workspace, busy, error, onRate }: { workspace: GigWorkspace; busy: boolean; error: string | null; onRate: (stars: number) => void }): React.ReactElement {
  const mine = workspace.ratings.find((r) => r.rated_by === 'creator');
  const [stars, setStars] = useState(5);
  if (mine) return <ProgramCard><Text style={s.strong}>You rated this host {String(mine.stars ?? '')}★</Text><Text style={s.small}>Ratings show once both sides rate, or after 7 days.</Text></ProgramCard>;
  return <ProgramCard>
    <Text style={s.title}>Rate the host</Text>
    <StarsInput value={stars} onChange={setStars} />
    {error ? <ProgramNotice tone="error" text={error} /> : null}
    <ProgramButton label="Send rating" busy={busy} onPress={() => onRate(stars)} />
  </ProgramCard>;
}

const styles = StyleSheet.create({
  brandTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: C.accent, fontWeight: '900' },
  trackRow: { flexDirection: 'row', gap: 12, minHeight: 44 },
  trackRail: { width: 16, alignItems: 'center' },
  dot: { width: 14, height: 14, borderRadius: 7, borderWidth: 2, borderColor: C.faint, marginTop: 3 },
  dotDone: { backgroundColor: C.accent, borderColor: C.accent },
  dotNow: { borderColor: C.accent, backgroundColor: C.canvas },
  line: { flex: 1, width: 2, backgroundColor: 'rgba(255,255,255,0.12)', marginVertical: 2 },
  lineDone: { backgroundColor: C.accent },
  trackText: { flex: 1, paddingBottom: 12, gap: 2 },
  two: { flexDirection: 'row', gap: 10 },
  footerStack: { gap: 8 },
  event: { paddingVertical: 10, gap: 2 },
  eventBorder: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.border },
  part: { gap: 8, paddingTop: 6 },
  bar: { height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden' },
  fill: { height: 8, backgroundColor: C.accent },
});
