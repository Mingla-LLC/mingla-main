import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Clipboard, Image, Pressable, StyleSheet, Text, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { normalizeContentShareNote, selectCompactPreviewFacts, shareKindLabel, statusLabel } from '@mingla/sharing';
import { BaseBottomSheet, BottomSheetTextInput } from '../ui/BaseBottomSheet';
import { Icon } from '../ui/Icon';
import { colors } from '../../constants/colors';
import {
  prepareContentShare, sharePreparedContent, type PreparedContentShare,
  trackContentShareEvent,
} from '../../services/contentShareAdapter';
import {
  clearContentShareOperationId, listContentShareRecipients, loadContentShareOperation, reconcileContentShareOperation,
  sendContentShareToRecipients, type ContentShareRecipient,
} from '../../services/contentShareDeliveryService';
import { registerContentShareHandler, type OpenContentShareInput } from '../../services/contentShareController';
import { HapticFeedback } from '../../utils/hapticFeedback';

type UnifiedShareContextValue = { openContentShare: (input: OpenContentShareInput) => void };
const UnifiedShareContext = createContext<UnifiedShareContextValue | null>(null);

export function useUnifiedShare(): UnifiedShareContextValue {
  const value = useContext(UnifiedShareContext);
  if (!value) throw new Error('UnifiedShareProvider is missing');
  return value;
}

const initials = (name: string): string => name.split(/\s+/u).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

export function UnifiedShareProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const dark = useColorScheme() === 'dark';
  const { fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const netInfo = useNetInfo();
  const isOffline = netInfo.isConnected === false || netInfo.isInternetReachable === false;
  const styles = useMemo(() => createStyles(dark), [dark]);
  const generation = useRef(0);
  const posterStartedAt = useRef(0);
  const [visible, setVisible] = useState(false);
  const [input, setInput] = useState<OpenContentShareInput | null>(null);
  const [prepared, setPrepared] = useState<PreparedContentShare | null>(null);
  const [prepError, setPrepError] = useState(false);
  const [recipients, setRecipients] = useState<ContentShareRecipient[]>([]);
  const [recipientsLoading, setRecipientsLoading] = useState(false);
  const [recipientsReady, setRecipientsReady] = useState(false);
  const [recipientError, setRecipientError] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [note, setNote] = useState('');
  const [noteExpanded, setNoteExpanded] = useState(false);
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  const [deliveryState, setDeliveryState] = useState<Record<string, 'sent' | 'failed'>>({});
  const [posterFailed, setPosterFailed] = useState(false);
  const [externalError, setExternalError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<
    | { kind: 'idle' }
    | { kind: 'success'; sent: number }
    | { kind: 'partial'; sent: number; failed: number }
    | { kind: 'failed'; failed: number }
  >({ kind: 'idle' });

  const loadShare = useCallback((nextInput: OpenContentShareInput, token: number): void => {
    const startedAt = Date.now();
    setPrepError(false);
    void prepareContentShare(nextInput.kind, nextInput.identity, 'generic', nextInput.messageContext)
      .then((value) => {
        if (generation.current === token) {
          setPrepared(value);
          trackContentShareEvent('share_link_ready', { kind: nextInput.kind, duration_ms: Date.now() - startedAt });
        }
        console.info('[content-share] preparation', { result: 'ready', durationMs: Date.now() - startedAt });
      })
      .catch(() => {
        if (generation.current === token) setPrepError(true);
        trackContentShareEvent('share_failure', { kind: nextInput.kind, failure_type: 'prepare', duration_ms: Date.now() - startedAt });
        console.info('[content-share] preparation', { result: 'failed', durationMs: Date.now() - startedAt });
      });
  }, []);

  const loadRecipients = useCallback((token: number): void => {
    const startedAt = Date.now();
    setRecipientError(false); setRecipientsLoading(true);
    setRecipientsReady(false);
    void listContentShareRecipients()
      .then((value) => {
        if (generation.current === token) { setRecipients(value); setRecipientsReady(true); }
        console.info('[content-share] recipients', { result: 'ready', durationMs: Date.now() - startedAt, count: value.length });
      })
      .catch(() => {
        if (generation.current === token) setRecipientError(true);
        console.info('[content-share] recipients', { result: 'failed', durationMs: Date.now() - startedAt });
      })
      .finally(() => { if (generation.current === token) setRecipientsLoading(false); });
  }, []);

  const openContentShare = useCallback((nextInput: OpenContentShareInput): void => {
    const shellStartedAt = Date.now();
    const token = generation.current + 1;
    generation.current = token;
    setInput(nextInput); setPrepared(null); setPrepError(false); setRecipients([]);
    setRecipientError(false); setRecipientsReady(false); setSelected(new Set()); setNote(''); setNoteExpanded(false);
    setSearch(''); setCopied(false); setSending(false);
    setDeliveryState({}); setPosterFailed(false); setExternalError(null);
    setOutcome({ kind: 'idle' }); setVisible(true); // synchronous: never wait before opening.
    trackContentShareEvent('share_sheet_opened', { kind: nextInput.kind, result: 'committed', duration_ms: Date.now() - shellStartedAt });
    console.info('[content-share] shell', { result: 'committed', durationMs: Date.now() - shellStartedAt });
    loadShare(nextInput, token);
    loadRecipients(token);
  }, [loadRecipients, loadShare]);

  useEffect(() => { registerContentShareHandler(openContentShare); return () => registerContentShareHandler(null); }, [openContentShare]);
  useEffect(() => {
    if (!prepared || !recipientsReady) return;
    const token = generation.current;
    void loadContentShareOperation(prepared.shortCode, prepared.version).then((operation) => {
      if (!operation || generation.current !== token) return;
      void reconcileContentShareOperation(operation, recipients).then((reconciled) => {
        if (generation.current !== token) return;
        setNote(reconciled.senderNote ?? '');
        setNoteExpanded(reconciled.senderNote !== null);
        setDeliveryState(Object.fromEntries(reconciled.targets.filter((target) => target.state !== 'pending').map((target) => [target.key, target.state as 'sent' | 'failed'])));
        setSelected(new Set(reconciled.targets.filter((target) => target.state !== 'sent').map((target) => target.key)));
      });
    });
  }, [prepared, recipients, recipientsReady]);

  useEffect(() => {
    posterStartedAt.current = prepared?.media?.posterUrl ? Date.now() : 0;
  }, [prepared?.media?.posterUrl]);

  const value = useMemo(() => ({ openContentShare }), [openContentShare]);
  const close = useCallback(() => { if (sending) return; generation.current += 1; setVisible(false); }, [sending]);
  const toggleRecipient = useCallback((key: string) => {
    if (sending || deliveryState[key] === 'sent') return;
    HapticFeedback.selection();
    setSelected((current) => {
    const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next;
    });
  }, [deliveryState, sending]);

  const nativeShare = useCallback(async () => {
    if (!prepared || sending) return;
    setExternalError(null); setSending(true);
    try {
      await sharePreparedContent(prepared);
      trackContentShareEvent('share_sheet_returned', { kind: prepared.kind, result: 'returned' });
    }
    catch {
      setExternalError('Couldn’t open sharing. Please try again.');
      trackContentShareEvent('share_failure', { kind: prepared.kind, failure_type: 'native_share' });
    }
    finally { setSending(false); }
  }, [prepared, sending]);

  const copyLink = useCallback(async () => {
    if (!prepared) return;
    setExternalError(null);
    try {
      await Clipboard.setString(prepared.canonicalUrl);
      setCopied(true);
      AccessibilityInfo.announceForAccessibility('Link copied');
      setTimeout(() => setCopied(false), 1200);
    } catch { setExternalError('Couldn’t copy the link. Please try again.'); }
  }, [prepared]);

  const send = useCallback(async () => {
    if (!prepared || sending || selected.size === 0 || isOffline) return;
    const targets = recipients.filter((recipient) => selected.has(recipient.key));
    if (targets.length === 0) {
      setSelected(new Set());
      AccessibilityInfo.announceForAccessibility('Those chats are no longer available. Choose someone else.');
      return;
    }
    setSending(true); setOutcome({ kind: 'idle' });
    try {
      const result = await sendContentShareToRecipients({
        recipients: targets, shortCode: prepared.shortCode,
        shareVersion: prepared.version, senderNote: note, title: prepared.title,
        onSettled: (key, state) => setDeliveryState((current) => ({ ...current, [key]: state })),
      });
      if (result.failed === 0) {
        await clearContentShareOperationId(prepared.shortCode, prepared.version);
        HapticFeedback.success();
        setOutcome({ kind: 'success', sent: result.sent });
      } else {
        setSelected(new Set(result.failedKeys));
        setOutcome(result.sent > 0
          ? { kind: 'partial', sent: result.sent, failed: result.failed }
          : { kind: 'failed', failed: result.failed });
      }
    } catch {
      setOutcome({ kind: 'failed', failed: selected.size });
    } finally { setSending(false); }
  }, [isOffline, note, prepared, recipients, selected, sending]);

  const finishSuccess = useCallback(() => {
    generation.current += 1;
    setSelected(new Set()); setNote(''); setVisible(false); setOutcome({ kind: 'idle' });
  }, []);

  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visibleRecipients = recipients.filter((recipient) => !normalizedSearch || `${recipient.displayName} ${recipient.username ?? ''}`.toLocaleLowerCase().includes(normalizedSearch));
  const noteState = useMemo(() => {
    try { return normalizeContentShareNote(note); } catch { return { note: null, graphemeCount: 0 }; }
  }, [note]);
  const failedCount = Object.values(deliveryState).filter((state) => state === 'failed').length;
  const sendLabel = sending ? `Sending to ${selected.size}…` : failedCount > 0 ? `Retry ${selected.size}` : selected.size === 0 ? 'Select someone in Mingla' : `Send to ${selected.size} ${selected.size === 1 ? 'chat' : 'chats'}`;
  const facts = prepared ? selectCompactPreviewFacts(prepared.facts, 2).join(' · ') : '';
  const shareHeading = prepared && fontScale < 1.4 ? `Share ${prepared.title}` : 'Share';
  const header = <View style={styles.header}><Text numberOfLines={1} ellipsizeMode="tail" style={styles.heading}>{shareHeading}</Text><Pressable style={styles.closeTarget} accessibilityRole="button" accessibilityLabel="Close share" disabled={sending} onPress={outcome.kind === 'success' ? finishSuccess : close}><Text style={styles.close}>×</Text></Pressable></View>;
  const footer = outcome.kind === 'success'
    ? <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}><Pressable accessibilityRole="button" onPress={finishSuccess} style={styles.sendButton}><Text style={styles.sendText}>Done</Text></Pressable></View>
    : <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>{prepared && isOffline ? <Text accessibilityLiveRegion="polite" style={styles.offlineCopy}>You're offline. Reconnect to send in Mingla.</Text> : null}<Pressable accessibilityRole="button" disabled={!prepared || selected.size === 0 || sending || isOffline} onPress={() => void send()} style={[styles.sendButton, (!prepared || selected.size === 0 || sending || isOffline) && styles.disabled]}><Text style={styles.sendText}>{sendLabel}</Text></Pressable></View>;

  return <UnifiedShareContext.Provider value={value}>
    {children}
    <BaseBottomSheet accessibilityLabel={`Share ${prepared?.title ?? input?.kind ?? ''}`} visible={visible} onClose={close} theme={dark ? 'dark' : 'light'} snapPoints={['90%']} enablePanDownToClose={!sending} scrollMode="scroll" wrapInRNModal keyboardBehavior="interactive" keyboardBlurBehavior="restore" android_keyboardInputMode="adjustResize" header={header} stickyFooter={footer} scrollProps={{ keyboardShouldPersistTaps: 'handled', contentContainerStyle: styles.body }}>
      {outcome.kind === 'success' ? <View style={styles.successState} accessibilityLiveRegion="polite"><View style={styles.successCheck}><Text style={styles.successCheckText}>✓</Text></View><Text style={styles.successTitle}>Sent to {outcome.sent} {outcome.sent === 1 ? 'chat' : 'chats'}</Text></View> : <>
      <View style={styles.summary}>
        {!prepared && !prepError ? <View accessibilityLabel="Preparing cover" style={styles.posterSkeleton} /> : prepared?.media?.posterUrl && !posterFailed ? <View style={styles.posterWrap}><Image source={{ uri: prepared.media.posterUrl }} style={styles.poster} onLoad={() => trackContentShareEvent('share_poster_result', { kind: prepared.kind, result_class: 'ready', duration_ms: Math.max(0, Date.now() - posterStartedAt.current) })} onError={() => { setPosterFailed(true); trackContentShareEvent('share_poster_result', { kind: prepared.kind, result_class: 'failed', duration_ms: Math.max(0, Date.now() - posterStartedAt.current) }); }} />{prepared.media.kind === 'gif' || prepared.media.kind === 'video' ? <View style={styles.mediaTag}><Text style={styles.mediaTagText}>{prepared.media.kind === 'gif' ? 'GIF' : 'Video'}</Text></View> : null}</View> : <View accessibilityLabel="No cover" style={styles.posterFallback}><Text style={styles.posterFallbackText}>{prepared ? shareKindLabel(prepared.kind).slice(0, 1) : 'M'}</Text></View>}
        <View style={styles.summaryCopy}><Text numberOfLines={1} style={styles.summaryMeta}>{prepared ? `${shareKindLabel(prepared.kind)}${statusLabel(prepared.facts.status) ? ` · ${statusLabel(prepared.facts.status)}` : ''}` : input ? shareKindLabel(input.kind) : 'Mingla'}</Text><Text numberOfLines={2} style={styles.title}>{prepared?.title ?? 'Preparing share…'}</Text>{facts ? <Text numberOfLines={2} style={styles.subtitle}>{facts}</Text> : null}</View>
      </View>
      {prepError ? <View style={styles.errorRow}><Text style={styles.errorText}>Couldn't prepare this share</Text><Pressable accessibilityRole="button" onPress={() => input && loadShare(input, generation.current)}><Text style={styles.retry}>Retry share</Text></Pressable></View> : null}
      <Text style={styles.sectionTitle}>Share elsewhere</Text>
      <View style={styles.actionRow}>
        <Pressable accessibilityRole="button" accessibilityLabel="Share elsewhere" disabled={!prepared || sending} onPress={() => void nativeShare()} style={[styles.action, (!prepared || sending) && styles.disabled]}><Text style={styles.actionText}>Share</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={copied ? 'Link copied' : 'Copy link'} disabled={!prepared || sending} onPress={() => void copyLink()} style={[styles.copyAction, (!prepared || sending) && styles.disabled]}><Text style={styles.actionText}>{copied ? '✓' : '⧉'}</Text></Pressable>
      </View>
      {externalError ? <Text accessibilityLiveRegion="polite" style={styles.errorText}>{externalError}</Text> : null}
      <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Send in Mingla</Text>{fontScale < 1.4 ? <Text style={styles.helper}>People and chats</Text> : null}</View>
      <View style={styles.searchWrap}><View accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Icon name="search-outline" size={19} color="#6B7280" /></View><BottomSheetTextInput accessibilityLabel="Search people and chats" value={search} onChangeText={setSearch} placeholder="Search people and chats" placeholderTextColor="#6B7280" style={styles.search} /></View>
      {recipientError ? <View style={styles.errorRow}><Text style={styles.errorText}>Couldn't load people and chats</Text><Pressable accessibilityRole="button" onPress={() => loadRecipients(generation.current)}><Text style={styles.retry}>Retry list</Text></Pressable></View> : null}
      {recipientsLoading ? [0,1,2].map((item) => <View key={item} style={styles.recipientSkeleton} />) : null}
      {!recipientsLoading && !recipientError && recipients.length === 0 ? <Text style={styles.empty}>No Mingla chats or friends yet. You can still share elsewhere.</Text> : null}
      {!recipientsLoading && recipients.length > 0 && visibleRecipients.length === 0 ? <View style={styles.noResults}><Text style={styles.empty}>No people or chats match “{search}”</Text><Pressable accessibilityRole="button" onPress={() => setSearch('')}><Text style={styles.retry}>Clear search</Text></Pressable></View> : null}
      {outcome.kind === 'partial' ? <Text accessibilityLiveRegion="polite" style={styles.resultBanner}>Sent to {outcome.sent}; couldn't send to {outcome.failed}</Text> : null}
      {outcome.kind === 'failed' ? <Text accessibilityLiveRegion="polite" style={styles.errorBanner}>Couldn't send yet. Nothing was duplicated.</Text> : null}
      {visibleRecipients.map((recipient) => {
        const active = selected.has(recipient.key);
        const sent = deliveryState[recipient.key] === 'sent';
        const stateLabel = sent ? 'Sent' : active ? 'Selected' : 'Not selected';
        return <Pressable key={recipient.key} onPress={() => toggleRecipient(recipient.key)} disabled={sent || sending} accessibilityRole="checkbox" accessibilityLabel={`${recipient.displayName}. ${stateLabel}`} accessibilityState={{ checked: active, disabled: sent || sending }} style={[styles.recipient, active && styles.recipientSelected]}>
          {recipient.avatarUrl ? <Image source={{ uri: recipient.avatarUrl }} style={styles.avatar} /> : <View style={styles.avatarFallback}><Text style={styles.avatarText}>{initials(recipient.displayName)}</Text></View>}
          <View style={styles.recipientCopy}><Text numberOfLines={1} style={styles.recipientName}>{recipient.displayName}</Text><Text numberOfLines={1} style={styles.recipientMeta}>{recipient.targetKind === 'group' ? `Group chat · ${recipient.participantCount ?? 0}` : recipient.targetKind === 'friend' ? 'Friend · chat starts when sent' : recipient.conversationId ? 'Recent chat' : 'Direct chat'}</Text></View>
          {sent ? <Text style={styles.sentLabel}>Sent</Text> : <View style={[styles.check, active && styles.checkActive]}><Text style={styles.checkText}>{active ? '✓' : ''}</Text></View>}
        </Pressable>;
      })}
      {!noteExpanded ? <Pressable accessibilityRole="button" onPress={() => setNoteExpanded(true)} style={styles.noteCollapsed}><Text style={styles.noteLabel}>Add a note (optional)</Text></Pressable> : <View><BottomSheetTextInput editable={!sending && Object.keys(deliveryState).length === 0} value={note} onChangeText={(value) => { try { setNote(normalizeContentShareNote(value).note ?? ''); } catch { /* unsupported engine: preserve prior note */ } }} multiline maxLength={480} placeholder="Add a note for the people you chose" placeholderTextColor="#6B7280" style={styles.note} />{noteState.graphemeCount >= 100 ? <Text accessibilityLiveRegion="polite" style={styles.counter}>{noteState.graphemeCount}/120</Text> : null}</View>}
      </>}
    </BaseBottomSheet>
  </UnifiedShareContext.Provider>;
}

const createStyles = (dark: boolean) => {
  const sheet = dark ? '#0C0E12' : '#FFFFFF';
  const surface = dark ? '#17191F' : '#F9FAFB';
  const selected = dark ? 'rgba(235,120,37,.18)' : '#FFF3E9';
  const border = dark ? 'rgba(255,255,255,.12)' : '#E5E7EB';
  const primary = dark ? 'rgba(255,255,255,.96)' : '#111827';
  const secondary = dark ? 'rgba(255,255,255,.72)' : '#6B7280';
  const error = dark ? '#FCA5A5' : '#B91C1C';
  const success = dark ? '#86EFAC' : '#166534';
  return StyleSheet.create({
    header:{minHeight:60,alignItems:'center',justifyContent:'center',paddingHorizontal:60,paddingVertical:8,position:'relative'},heading:{width:'100%',fontSize:18,lineHeight:28,fontWeight:'700',color:primary,textAlign:'center'},closeTarget:{position:'absolute',right:8,width:44,height:44,alignItems:'center',justifyContent:'center'},close:{fontSize:30,lineHeight:32,color:primary}, body:{paddingHorizontal:16,paddingBottom:28,gap:20},
    summary:{minHeight:92,borderRadius:16,backgroundColor:surface,borderWidth:1,borderColor:border,padding:10,flexDirection:'row',alignItems:'center',gap:12},posterWrap:{width:64,height:72,position:'relative'},poster:{width:64,height:72,borderRadius:12},posterSkeleton:{width:64,height:72,borderRadius:12,backgroundColor:dark?'#24272E':'#F3F4F6'},mediaTag:{position:'absolute',right:4,bottom:4,borderRadius:6,backgroundColor:'#0C0E12',paddingHorizontal:5,paddingVertical:2},mediaTagText:{fontSize:9,fontWeight:'700',color:'#fff'},posterFallback:{width:64,height:72,borderRadius:12,backgroundColor:'#0C0E12',alignItems:'center',justifyContent:'center'},posterFallbackText:{fontSize:28,fontWeight:'800',color:'#fff'},summaryCopy:{flex:1},summaryMeta:{fontSize:12,lineHeight:16,fontWeight:'700',color:secondary},title:{fontSize:17,lineHeight:22,fontWeight:'700',color:primary,marginTop:2},subtitle:{fontSize:13,lineHeight:18,fontWeight:'500',color:secondary,marginTop:3},
    actionRow:{height:52,flexDirection:'row',gap:8},action:{flex:1,minHeight:52,borderRadius:16,backgroundColor:surface,borderWidth:1,borderColor:border,alignItems:'center',justifyContent:'center'},copyAction:{width:52,height:52,borderRadius:16,backgroundColor:surface,borderWidth:1,borderColor:border,alignItems:'center',justifyContent:'center'},actionText:{fontSize:16,fontWeight:'700',color:primary},disabled:{opacity:.45},sectionHeading:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},sectionTitle:{fontSize:16,lineHeight:24,fontWeight:'600',color:primary},helper:{fontSize:12,lineHeight:16,fontWeight:'500',color:secondary},searchWrap:{minHeight:48,borderWidth:1,borderColor:border,borderRadius:12,paddingHorizontal:12,backgroundColor:surface,flexDirection:'row',alignItems:'center',gap:8},search:{flex:1,minHeight:46,paddingHorizontal:0,color:primary,backgroundColor:'transparent'},
    recipient:{minHeight:60,flexDirection:'row',alignItems:'center',gap:12,paddingHorizontal:8,paddingVertical:8,borderRadius:12,borderWidth:1,borderColor:'transparent'},recipientSelected:{backgroundColor:selected,borderColor:colors.primary},recipientSkeleton:{height:60,borderRadius:12,backgroundColor:dark?'#24272E':'#F3F4F6'},avatar:{width:44,height:44,borderRadius:22},avatarFallback:{width:44,height:44,borderRadius:22,backgroundColor:dark?'#342A24':'#ece4dc',alignItems:'center',justifyContent:'center'},avatarText:{fontWeight:'700',color:dark?'#F7C49D':'#5f4939'},recipientCopy:{flex:1},recipientName:{fontSize:15,lineHeight:20,fontWeight:'600',color:primary},recipientMeta:{fontSize:12,lineHeight:16,fontWeight:'500',color:secondary,marginTop:2},check:{width:24,height:24,borderRadius:12,borderWidth:1.5,borderColor:dark?'rgba(255,255,255,.5)':'#9CA3AF',alignItems:'center',justifyContent:'center'},checkActive:{backgroundColor:colors.primary,borderColor:colors.primary},checkText:{fontSize:15,fontWeight:'800',color:'#0C0E12'},sentLabel:{fontSize:12,fontWeight:'700',color:success},
    noteCollapsed:{minHeight:48,borderRadius:12,borderWidth:1,borderColor:border,justifyContent:'center',paddingHorizontal:14},noteLabel:{fontSize:15,color:primary},note:{minHeight:64,maxHeight:96,borderWidth:1,borderColor:border,borderRadius:12,paddingHorizontal:14,paddingVertical:10,color:primary,backgroundColor:surface},counter:{alignSelf:'flex-end',fontSize:12,color:secondary,marginTop:4},
    footer:{paddingTop:12,paddingHorizontal:16,paddingBottom:12,backgroundColor:sheet,borderTopWidth:StyleSheet.hairlineWidth,borderTopColor:border,gap:8},offlineCopy:{fontSize:13,lineHeight:18,textAlign:'center',color:secondary},sendButton:{height:52,borderRadius:16,backgroundColor:colors.primary,alignItems:'center',justifyContent:'center'},sendText:{fontSize:17,fontWeight:'800',color:'#0C0E12'},errorRow:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},errorText:{color:error},retry:{fontWeight:'700',color:dark?'#F7A15F':'#9A470A'},empty:{color:secondary,paddingVertical:8},noResults:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},resultBanner:{color:success,backgroundColor:dark?'#12321F':'#F0FDF4',padding:12,borderRadius:12},errorBanner:{color:error,backgroundColor:dark?'#351719':'#FEF2F2',padding:12,borderRadius:12},successState:{minHeight:260,alignItems:'center',justifyContent:'center',gap:16},successCheck:{width:64,height:64,borderRadius:32,backgroundColor:colors.primary,alignItems:'center',justifyContent:'center'},successCheckText:{fontSize:32,fontWeight:'800',color:'#0C0E12'},successTitle:{fontSize:20,lineHeight:28,fontWeight:'700',color:primary},
  });
};
