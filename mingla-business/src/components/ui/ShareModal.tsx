import React, { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Dimensions, Image, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import type { ShareEntityKind } from '@mingla/sharing';
import { selectPreviewFacts, shareKindLabel, statusLabel } from '@mingla/sharing';
import { copyPublicUrl, sharePublicUrl } from '../../utils/sharePublicUrl';
import { trackBusinessShareEvent, type PreparedBusinessShare } from '../../services/contentShareAdapter';
import { Sheet } from './Sheet';

const QRCode = React.lazy(() => import('react-native-qrcode-svg'));

export interface ShareModalProps {
  visible: boolean;
  onClose: () => void;
  url: string;
  title: string;
  description?: string;
  contentKind: ShareEntityKind;
}

function canWebShare(): boolean {
  return Platform.OS !== 'web' || typeof (globalThis as { navigator?: { share?: unknown } }).navigator?.share === 'function';
}

export const ShareModal: React.FC<ShareModalProps> = ({ visible, onClose, url, title, contentKind }) => {
  const { fontScale } = useWindowDimensions();
  const generation = useRef(0);
  const posterStartedAt = useRef(0);
  const busyRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const dialogRef = useRef<View | null>(null);
  const [prepared, setPrepared] = useState<PreparedBusinessShare | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const [posterFailed, setPosterFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [contentHeight, setContentHeight] = useState(0);

  const prepare = useCallback(() => {
    const token = generation.current;
    const startedAt = Date.now();
    setFailed(false);
    void import('../../services/contentShareAdapter')
      .then(({ prepareBusinessContentShare }) => prepareBusinessContentShare(url, 'generic', contentKind))
      .then((value) => {
        if (generation.current === token) {
          setPrepared(value);
          trackBusinessShareEvent('share_link_ready', { kind: contentKind, result_class: 'ready', duration_ms: Date.now() - startedAt });
        }
      })
      .catch(() => {
        if (generation.current === token) setFailed(true);
        trackBusinessShareEvent('share_failure', { kind: contentKind, failure_type: 'prepare', result_class: 'failed', duration_ms: Date.now() - startedAt });
      });
  }, [contentKind, url]);

  useEffect(() => {
    if (!visible) return;
    generation.current += 1;
    setPrepared(null); setFailed(false); setBusy(false); setCopied(false); setShowQr(false);
    setPosterFailed(false); setActionError(null); setContentHeight(0);
    trackBusinessShareEvent('share_sheet_opened', { kind: contentKind, result: 'committed' });
    prepare();
  }, [prepare, visible]);

  useEffect(() => { busyRef.current = busy; }, [busy]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => { posterStartedAt.current = prepared?.media?.posterUrl ? Date.now() : 0; }, [prepared?.media?.posterUrl]);

  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    type WebFocusTarget = { focus?: () => void };
    type WebDialog = WebFocusTarget & {
      contains?: (target: unknown) => boolean;
      querySelectorAll?: (selector: string) => ArrayLike<WebFocusTarget>;
    };
    const documentValue = (globalThis as { document?: {
      activeElement?: WebFocusTarget;
      addEventListener: (type: string, listener: (event: KeyboardEvent) => void) => void;
      removeEventListener: (type: string, listener: (event: KeyboardEvent) => void) => void;
    } }).document;
    if (!documentValue) return;
    const invokingControl = documentValue.activeElement;
    const selector = 'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = (): WebFocusTarget[] => Array.from((dialogRef.current as unknown as WebDialog | null)?.querySelectorAll?.(selector) ?? []);
    const focusTimer = setTimeout(() => focusables()[0]?.focus?.(), 0);
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) { event.preventDefault(); return; }
      const active = documentValue.activeElement;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (active === first || !(dialogRef.current as unknown as WebDialog | null)?.contains?.(active))) {
        event.preventDefault(); last.focus?.();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault(); first.focus?.();
      }
    };
    documentValue.addEventListener('keydown', onKeyDown);
    return () => {
      clearTimeout(focusTimer);
      documentValue.removeEventListener('keydown', onKeyDown);
      invokingControl?.focus?.();
    };
  }, [visible]);

  const share = async (): Promise<void> => {
    if (!prepared || busy) return;
    setActionError(null); setBusy(true);
    try {
      await sharePublicUrl({ title: prepared.title, url: prepared.url, description: prepared.message });
      trackBusinessShareEvent('share_sheet_returned', { kind: contentKind, result: 'returned' });
    }
    catch {
      setActionError("Couldn't open sharing. Please try again.");
      trackBusinessShareEvent('share_failure', { kind: contentKind, failure_type: 'native_share' });
    }
    finally { setBusy(false); }
  };
  const copy = async (): Promise<void> => {
    if (!prepared || busy) return;
    setActionError(null); setBusy(true);
    try { await copyPublicUrl(prepared.url); setCopied(true); AccessibilityInfo.announceForAccessibility('Link copied'); setTimeout(() => setCopied(false), 1200); }
    catch { setActionError("Couldn't copy the link. Please try again."); }
    finally { setBusy(false); }
  };

  const facts = prepared ? selectPreviewFacts(prepared.facts, 2).join(' · ') : '';
  const status = prepared ? statusLabel(prepared.facts.status) : '';
  const fittedHeight = contentHeight > 0
    ? Math.min(contentHeight + 40, Dimensions.get('window').height * 0.9)
    : 0.55;
  return <Sheet visible={visible} onClose={busy ? () => undefined : onClose} snapPoint={fittedHeight}>
    <View ref={dialogRef} {...({ role: 'dialog' } as unknown as React.ComponentProps<typeof View>)} accessible accessibilityViewIsModal style={styles.container} accessibilityLabel={`Share ${title}`} onLayout={(event) => setContentHeight(Math.ceil(event.nativeEvent.layout.height))}>
      <View style={styles.header}><Text style={styles.heading}>Share</Text><Pressable accessibilityRole="button" accessibilityLabel="Close share" onPress={onClose} disabled={busy} style={styles.closeTarget}><Text style={styles.close}>×</Text></Pressable></View>
      <View style={styles.summary}>
        {!prepared && !failed ? <View accessibilityLabel="Preparing cover" style={styles.posterSkeleton} /> : prepared?.media?.posterUrl && !posterFailed ? <View style={styles.posterWrap}><Image source={{ uri: prepared.media.posterUrl }} style={styles.poster} onLoad={() => trackBusinessShareEvent('share_poster_result', { kind: contentKind, result_class: 'ready', duration_ms: Math.max(0, Date.now() - posterStartedAt.current) })} onError={() => { setPosterFailed(true); trackBusinessShareEvent('share_poster_result', { kind: contentKind, result_class: 'failed', duration_ms: Math.max(0, Date.now() - posterStartedAt.current) }); }} />{prepared.media.kind === 'gif' || prepared.media.kind === 'video' ? <View style={styles.tag}><Text style={styles.tagText}>{prepared.media.kind === 'gif' ? 'GIF' : 'Video'}</Text></View> : null}</View> : <View accessibilityLabel="No cover" style={styles.noCover}><Text style={styles.noCoverText}>{shareKindLabel(contentKind).slice(0, 1)}</Text></View>}
        <View style={styles.copy}><Text numberOfLines={1} style={styles.meta}>{prepared ? `${shareKindLabel(prepared.facts.kind)}${status ? ` · ${status}` : ''}` : shareKindLabel(contentKind)}</Text><Text numberOfLines={2} style={styles.title}>{prepared?.title ?? 'Preparing share…'}</Text>{facts ? <Text numberOfLines={2} style={styles.facts}>{facts}</Text> : null}</View>
      </View>
      {failed ? <View style={styles.errorRow}><Text style={styles.error}>Couldn't prepare this share</Text><Pressable onPress={prepare}><Text style={styles.retry}>Retry share</Text></Pressable></View> : null}
      {fontScale < 1.4 ? <Text style={styles.section}>Share elsewhere</Text> : null}
      <View style={styles.actions}>
        {canWebShare() ? <Pressable disabled={!prepared || busy} onPress={() => void share()} style={[styles.shareButton, (!prepared || busy) && styles.disabled]}>{busy ? <ActivityIndicator color="#111827" /> : <Text style={styles.buttonText}>Share</Text>}</Pressable> : null}
        <Pressable accessibilityLabel={copied ? 'Link copied' : 'Copy link'} disabled={!prepared || busy} onPress={() => void copy()} style={[styles.iconButton, (!prepared || busy) && styles.disabled]}><Text style={styles.buttonText}>{copied ? '✓' : '⧉'}</Text></Pressable>
        {Platform.OS === 'web' ? <Pressable accessibilityLabel={showQr ? 'Hide QR' : 'Show QR'} disabled={!prepared} onPress={() => setShowQr((value) => !value)} style={[styles.iconButton, !prepared && styles.disabled]}><Text style={styles.buttonText}>QR</Text></Pressable> : null}
      </View>
      {actionError ? <Text accessibilityLiveRegion="polite" style={styles.error}>{actionError}</Text> : null}
      {Platform.OS === 'web' && showQr && prepared ? <View style={styles.qr}><Suspense fallback={<ActivityIndicator />}><QRCode value={prepared.url} size={160} /></Suspense><Text style={styles.qrLabel}>Scan to open</Text></View> : null}
    </View>
  </Sheet>;
};

const styles = StyleSheet.create({
  container:{width:'100%',maxWidth:480,alignSelf:'center',paddingHorizontal:16,paddingBottom:20,gap:20},header:{minHeight:60,flexDirection:'row',alignItems:'center'},heading:{flex:1,fontSize:18,lineHeight:28,fontWeight:'700',color:'#F9FAFB'},closeTarget:{width:44,height:44,alignItems:'center',justifyContent:'center'},close:{fontSize:30,color:'#F9FAFB'},summary:{minHeight:104,borderRadius:16,borderWidth:1,borderColor:'rgba(255,255,255,.12)',backgroundColor:'#17191F',padding:10,flexDirection:'row',alignItems:'center',gap:12},posterWrap:{width:64,height:80,position:'relative'},poster:{width:64,height:80,borderRadius:12},posterSkeleton:{width:64,height:80,borderRadius:12,backgroundColor:'#24272E'},noCover:{width:64,height:80,borderRadius:12,backgroundColor:'#0C0E12',alignItems:'center',justifyContent:'center'},noCoverText:{fontSize:28,fontWeight:'800',color:'#F9FAFB'},tag:{position:'absolute',right:4,bottom:4,backgroundColor:'#0C0E12',borderRadius:6,paddingHorizontal:5,paddingVertical:2},tagText:{fontSize:9,fontWeight:'700',color:'#fff'},copy:{flex:1},meta:{fontSize:12,lineHeight:16,fontWeight:'700',color:'rgba(255,255,255,.72)'},title:{fontSize:17,lineHeight:22,fontWeight:'700',color:'#F9FAFB',marginTop:2},facts:{fontSize:13,lineHeight:18,color:'rgba(255,255,255,.72)',marginTop:3},section:{fontSize:16,lineHeight:24,fontWeight:'600',color:'#F9FAFB'},actions:{height:52,flexDirection:'row',gap:8},shareButton:{flex:1,height:52,borderRadius:16,borderWidth:1,borderColor:'rgba(255,255,255,.12)',backgroundColor:'#17191F',alignItems:'center',justifyContent:'center'},iconButton:{width:52,height:52,borderRadius:16,borderWidth:1,borderColor:'rgba(255,255,255,.12)',backgroundColor:'#17191F',alignItems:'center',justifyContent:'center'},buttonText:{fontSize:16,fontWeight:'700',color:'#F9FAFB'},disabled:{opacity:.45},errorRow:{minHeight:44,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},error:{color:'#FCA5A5'},retry:{color:'#F7A15F',fontWeight:'700'},qr:{alignItems:'center',gap:8,padding:12,backgroundColor:'#fff',borderRadius:16},qrLabel:{fontSize:13,color:'#111827'},
});
