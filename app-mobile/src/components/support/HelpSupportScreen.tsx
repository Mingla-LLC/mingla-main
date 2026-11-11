/**
 * #4382 Wave 5 — Help & Support (journey 1, step 2): "New request" and
 * "Your requests". Replaces the beta-only Share Feedback button and the
 * Feedback History sheet; open to every Explorer user. Old beta reports that
 * were imported with a known person show here too, marked "From beta
 * feedback".
 */
import React, { useCallback } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useMySupportTickets } from '../../hooks/useSupportRequests';
import type { SupportTicketRow } from '../../services/supportTicketService';
import { formatTicketNumber, supportRoutePath } from '../../utils/supportRequestModel';
import { Icon } from '../ui/Icon';
import { SupportHeader, SupportStatusPill, supportStyles } from './supportUi';

function relativeWhen(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export function HelpSupportScreen(): React.ReactElement {
  const { t } = useTranslation('feedback');
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const tickets = useMySupportTickets();

  const goBack = useCallback((): void => {
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [router]);

  const row = (ticket: SupportTicketRow): React.ReactElement => {
    const number = formatTicketNumber(ticket.ticket_number);
    const meta = ticket.last_sender_kind === 'staff'
      ? t('feedback:support.row_meta_replied', { number, when: relativeWhen(ticket.last_message_at) })
      : t('feedback:support.row_meta', { number, when: relativeWhen(ticket.last_message_at) });
    return (
      <Pressable
        key={ticket.id}
        onPress={() => router.push(supportRoutePath(ticket.id) as never)}
        accessibilityRole="button"
        accessibilityLabel={t('feedback:support.open_request', { number, subject: ticket.subject })}
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        testID={`support-request-${ticket.id}`}
      >
        <View style={styles.rowCopy}>
          <Text style={styles.rowSubject} numberOfLines={1}>{ticket.subject}</Text>
          <Text style={styles.rowMeta} numberOfLines={1}>{meta}</Text>
          {ticket.imported_from === 'beta_feedback' ? (
            <Text style={styles.rowBeta}>{t('feedback:support.from_beta')}</Text>
          ) : null}
        </View>
        <SupportStatusPill status={ticket.status} />
        <Icon name="chevron-forward" size={18} color="rgba(255,255,255,0.4)" />
      </Pressable>
    );
  };

  return (
    <View style={supportStyles.screen}>
      <SupportHeader
        title={t('feedback:support.title')}
        backLabel={t('feedback:support.back')}
        onBack={goBack}
        topInset={insets.top}
      />
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]}
        refreshControl={
          <RefreshControl
            refreshing={tickets.isRefetching}
            onRefresh={() => void tickets.refetch()}
            tintColor="#ffffff"
          />
        }
      >
        <Pressable
          onPress={() => router.push('/support/new' as never)}
          accessibilityRole="button"
          accessibilityLabel={t('feedback:support.new_request')}
          style={supportStyles.primaryButton}
          testID="support-new-request"
        >
          <Icon name="add" size={20} color="#ffffff" />
          <Text style={supportStyles.primaryButtonText}>{t('feedback:support.new_request')}</Text>
        </Pressable>

        <Text style={[supportStyles.sectionLabel, styles.sectionGap]}>{t('feedback:support.your_requests')}</Text>

        {tickets.isLoading ? (
          <View style={styles.listState}><ActivityIndicator color="#ffffff" /></View>
        ) : tickets.isError ? (
          <View style={styles.listState}>
            <Text style={supportStyles.stateText}>{t('feedback:support.load_error')}</Text>
            <Pressable onPress={() => void tickets.refetch()} accessibilityRole="button" accessibilityLabel={t('feedback:support.try_again')} style={supportStyles.secondaryButton}>
              <Text style={supportStyles.secondaryButtonText}>{t('feedback:support.try_again')}</Text>
            </Pressable>
          </View>
        ) : (tickets.data ?? []).length === 0 ? (
          <View style={styles.listState}>
            <Text style={supportStyles.stateTitle}>{t('feedback:support.empty_title')}</Text>
            <Text style={supportStyles.stateText}>{t('feedback:support.empty_body')}</Text>
          </View>
        ) : (
          <View style={styles.list}>{(tickets.data ?? []).map(row)}</View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12 },
  sectionGap: { marginTop: 16 },
  listState: { paddingVertical: 32, alignItems: 'center', gap: 12 },
  list: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
  },
  rowPressed: { opacity: 0.7 },
  rowCopy: { flex: 1, minWidth: 0 },
  rowSubject: { color: '#f8fafc', fontSize: 15, fontWeight: '600' },
  rowMeta: { marginTop: 3, color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  rowBeta: { marginTop: 3, color: '#fdba74', fontSize: 11, fontWeight: '600' },
});
