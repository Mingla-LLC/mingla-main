import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { GigProposal, GigTerms, GigWorkspace } from '../../../services/creatorGigsService';
import { chooseAndUploadCreatorMedia, isPickerCancel } from '../../../services/creatorMediaService';
import { programErrorText } from '../../../services/programResult';
import { agreedVideoDueText, deliverablesLabel, formatDateRange, formatDateTime, formatMoney, formatShortDate, parseDay, platformLabel, proposalDueText, salesShareText, shootPickRange, usageLabel, videoDueText } from '../../../utils/programFormat';
import { PROGRAM_COLORS as C, ProgramButton, ProgramCard, ProgramField, ProgramNotice, ProgramPill, ProgramRow, ProgramSheet, programStyles as s } from '../../programs/ProgramUi';
import { CalendarGrid, CheckRow, Chip, StarsInput, TimeChips } from '../../programs/ProgramPickers';
import { playOwnVideo } from '../../programs/VideoTile';
import { POST_URL_RULES, TRACK_STEPS, TRACK_TITLES, actorWords, currentTrackStep, eventWords, fixWords, postCheckWords } from './contractWords';

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

export function TermsCard({ terms, gig }: { terms: GigTerms; gig: GigWorkspace['gig'] }): React.ReactElement {
  const window = gig.shoot_window;
  return <ProgramCard>
    <ProgramRow title="Fee" value={formatMoney(terms.fee_minor, terms.currency)} chevron={false} />
    {window ? <ProgramRow title="Shoot" value={formatDateRange(window.start, window.end)} chevron={false} />
      : terms.shoot_date ? <ProgramRow title="Shoot" value={formatShortDate(terms.shoot_date)} chevron={false} /> : null}
    <ProgramRow title="Video due" value={termsVideoDue(terms, gig)} chevron={false} />
    <ProgramRow title="Deliverables" value={deliverablesLabel(terms.deliverables)} chevron={false} />
    <ProgramRow title="Fixes included" value="2 technical" chevron={false} />
    {salesShareText(terms.sales_share_bps) ? <ProgramRow title="Plus" value={salesShareText(terms.sales_share_bps)!} chevron={false} /> : null}
    <ProgramRow title="Marketing rights" value={terms.rights_model === 'creator_v1_perpetual' ? 'Perpetual after full fee release' : usageLabel(terms.usage_days)} chevron={false} isLast />
  </ProgramCard>;
}

/** The agreed due (current terms): date and time. */
function termsVideoDue(terms: GigTerms, gig: GigWorkspace['gig']): string {
  return agreedVideoDueText(terms, gig);
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
        <Text style={s.strong}>{eventWords(e.kind)}</Text>
        <Text style={s.small}>{actorWords(e.actor)} · {formatDateTime(e.at)}</Text>
      </View>)}
    </ProgramCard>
  </>;
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

const SCRIPT_PARTS = [
  { key: 'hook', title: 'Hook · first 3 seconds', placeholder: 'What stops the scroll?' },
  { key: 'middle', title: 'Middle', placeholder: 'What people see and feel there' },
  { key: 'invite', title: 'Invite', placeholder: 'Why go, and how to book' },
] as const;
type ScriptPart = { on_screen: string; voiceover: string };

export function ScriptEditor({ workspace, editable, busy, error, onSave }: {
  workspace: GigWorkspace; editable: boolean; busy: boolean; error: string | null;
  onSave: (body: Record<string, unknown>, send: boolean) => void;
}): React.ReactElement {
  const latest = workspace.scripts[workspace.scripts.length - 1];
  const initialParts = useMemo(() => {
    const parts: Record<string, ScriptPart> = { hook: { on_screen: '', voiceover: '' }, middle: { on_screen: '', voiceover: '' }, invite: { on_screen: '', voiceover: '' } };
    (latest?.body?.sections ?? []).forEach((section, i) => {
      const key = typeof section.key === 'string' && section.key in parts ? section.key : SCRIPT_PARTS[i]?.key;
      if (key) parts[key] = { on_screen: String(section.on_screen ?? ''), voiceover: String(section.voiceover ?? '') };
    });
    return parts;
  }, [latest]);
  const [parts, setParts] = useState(initialParts);
  const [disclosure, setDisclosure] = useState<string>(typeof latest?.body?.disclosure === 'string' && latest.body.disclosure ? latest.body.disclosure : '#ad');
  const [confirmed, setConfirmed] = useState(Boolean(latest));
  useEffect(() => { setParts(initialParts); }, [initialParts]);

  const filled = SCRIPT_PARTS.filter((p) => (parts[p.key].on_screen + parts[p.key].voiceover).trim().length > 0).length;
  const body = (): Record<string, unknown> => ({
    sections: SCRIPT_PARTS.map((p) => ({ key: p.key, on_screen: parts[p.key].on_screen.trim(), voiceover: parts[p.key].voiceover.trim(), shot_notes: '' })),
    disclosure, estimated_seconds: 30,
  });

  if (!editable) {
    return <ProgramCard>
      <Text style={s.label}>{latest?.locked_at ? 'Locked script' : 'Your script'}</Text>
      {SCRIPT_PARTS.map((p) => (parts[p.key].on_screen || parts[p.key].voiceover) ? <View key={p.key} style={styles.part}>
        <Text style={s.strong}>{p.title}</Text>
        {parts[p.key].on_screen ? <Text style={s.copy}>On screen: {parts[p.key].on_screen}</Text> : null}
        {parts[p.key].voiceover ? <Text style={s.copy}>Say: {parts[p.key].voiceover}</Text> : null}
      </View> : null)}
      <Text style={s.small}>Disclosure: {disclosure}</Text>
    </ProgramCard>;
  }

  return <ProgramCard>
    <Text style={s.title}>Script</Text>
    {SCRIPT_PARTS.map((p) => <View key={p.key} style={styles.part}>
      <Text style={s.strong}>{p.title}</Text>
      <ProgramField label="On screen" value={parts[p.key].on_screen} onChangeText={(v) => setParts({ ...parts, [p.key]: { ...parts[p.key], on_screen: v } })} placeholder={p.placeholder} multiline maxLength={400} />
      <ProgramField label="What you say" value={parts[p.key].voiceover} onChangeText={(v) => setParts({ ...parts, [p.key]: { ...parts[p.key], voiceover: v } })} placeholder="Voiceover or lines" multiline maxLength={400} />
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

export function UploadCard({ contractId, workspace, onSubmit }: { contractId: string; workspace: GigWorkspace; onSubmit: (jobId: string) => Promise<void> }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const lastFix = workspace.deliveries.filter((d) => d.decision === 'fix_requested').slice(-1)[0];
  const fixing = workspace.contract.state === 'fix_requested';
  const upload = async (): Promise<void> => {
    setBusy(true); setProgress(0); setError(null);
    try {
      const media = await chooseAndUploadCreatorMedia({ purpose: 'delivery', contractId, onProgress: setProgress });
      await onSubmit(media.jobId);
    } catch (e) { if (!isPickerCancel(e)) setError(programErrorText(e)); } finally { setBusy(false); }
  };
  return <ProgramCard tone="highlight">
    <Text style={s.title}>{fixing ? 'Upload the fixed video' : 'Upload your video'}</Text>
    {fixing && lastFix ? <>
      <Text style={s.label}>What to fix</Text>
      {(lastFix.fix_categories ?? []).map((c) => <Text key={c} style={s.strong}>• {fixWords(c)}</Text>)}
      {lastFix.fix_note ? <Text style={s.copy}>“{lastFix.fix_note}”</Text> : null}
    </> : null}
    <Text style={s.copy}>Vertical, up to 90 seconds and 150 MB. Mingla keeps a private review copy for the host.</Text>
    {busy ? <View style={styles.bar}><View style={[styles.fill, { width: `${Math.max(4, Math.round(progress * 100))}%` }]} /></View> : null}
    {busy ? <Text style={s.small}>Uploading {Math.round(progress * 100)}%. Keep the app open.</Text> : null}
    {error ? <ProgramNotice tone="error" text={error} /> : null}
    <ProgramButton label="Choose video" icon="cloud-upload-outline" busy={busy} onPress={() => void upload()} />
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
  return <ProgramCard tone="highlight">
    <Text style={s.title}>Add your live links</Text>
    <Text style={s.copy}>One link per post. Copy it from the post itself.</Text>
    {list.map((p) => <ProgramField key={p} label={platformLabel(p)} value={urls[p] ?? ''} onChangeText={(v) => setUrls({ ...urls, [p]: v })} onBlur={() => setTouched(true)}
      placeholder={POST_URL_RULES[p].example} autoCapitalize="none" autoCorrect={false} spellCheck={false} keyboardType="url" textContentType="URL"
      error={touched && invalid.includes(p) ? `That doesn’t look like a ${platformLabel(p)} post link. It should look like ${POST_URL_RULES[p].example}` : null} />)}
    {error ? <ProgramNotice tone="error" text={error} /> : null}
    <ProgramButton label="Submit links" busy={busy} disabled={!ready} onPress={() => onSubmit(list.map((p) => ({ platform: p, url: urls[p].trim() })))} />
  </ProgramCard>;
}

export function PostsStatus({ workspace }: { workspace: GigWorkspace }): React.ReactElement | null {
  if (!workspace.posts.length) return null;
  return <ProgramCard>
    <Text style={s.label}>Your posts</Text>
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
