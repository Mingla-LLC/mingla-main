import React, { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
  StyleSheet,
  Alert,
} from 'react-native'
import { KeyboardAwareScrollView } from '../ui/KeyboardAwareScrollView'
import * as Haptics from 'expo-haptics'
import { useTranslation } from 'react-i18next'
import { Icon } from '../ui/Icon'

import { useSessionManagement, SessionParticipantInput } from '../../hooks/useSessionManagement'
import { AddedFriend, CreatedSession } from '../../types/onboarding'
import { SessionInvite } from '../../types'
import { supabase } from '../../services/supabase'
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  shadows,
} from '../../constants/designSystem'

interface OnboardingCollaborationStepProps {
  userId: string
  addedFriends: AddedFriend[]
  initialSessions?: CreatedSession[]
  userPreferences: {
    categories: string[]
    priceTiers: string[]
    intents: string[]
    travelMode: string
    travelTimeMinutes: number
  }
  onContinue: (sessions: CreatedSession[]) => void
  onSkip: () => void
  onActionTaken: () => void
}

export const OnboardingCollaborationStep: React.FC<OnboardingCollaborationStepProps> = ({
  userId,
  addedFriends,
  initialSessions,
  userPreferences,
  onContinue,
  onSkip,
  onActionTaken,
}) => {
  const { t } = useTranslation(['onboarding', 'common'])

  // Selected friends for new session (keyed by userId or phoneE164)
  const [selectedFriendKeys, setSelectedFriendKeys] = useState<Set<string>>(new Set())

  // Session name
  const [sessionName, setSessionName] = useState('')

  // Created sessions — restore from parent if navigating back
  const [createdSessions, setCreatedSessions] = useState<CreatedSession[]>(initialSessions ?? [])

  // Loading + error state
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  // Pending collaboration invites
  const [pendingCollabInvites, setPendingCollabInvites] = useState<SessionInvite[]>([])
  const [loadingInvites, setLoadingInvites] = useState(false)
  const [processingInviteId, setProcessingInviteId] = useState<string | null>(null)

  // Session management
  const {
    createCollaborativeSessionV2,
    acceptInvite,
    declineInvite,
    loadUserSessions,
    pendingInvites,
    loading: sessionsLoading,
  } = useSessionManagement()

  // Load pending collaboration invites on mount
  useEffect(() => {
    let cancelled = false

    const loadPendingInvites = async () => {
      setLoadingInvites(true)
      try {
        await loadUserSessions()
      } catch (err) {
        console.error('Error loading collaboration invites:', err)
      } finally {
        if (!cancelled) setLoadingInvites(false)
      }
    }
    loadPendingInvites()

    // Safety timeout — if loadUserSessions hangs, stop the spinner after 10s.
    // Show whatever data loaded so far rather than infinite spinner.
    const timeout = setTimeout(() => {
      if (!cancelled) setLoadingInvites(false)
    }, 10_000)

    return () => { cancelled = true; clearTimeout(timeout) }
  }, [loadUserSessions])

  // Listen for late-arriving collaboration invites in real-time.
  // The invite may be created by a DB trigger AFTER this component mounts
  // (e.g. user accepted a friend request in the previous substep, and the
  // trigger converted pending_session_invites into collaboration_invites).
  useEffect(() => {
    if (!userId) return

    const channel = supabase
      .channel(`onboarding-collab-invites:${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'collaboration_invites',
          filter: `invited_user_id=eq.${userId}`,
        },
        () => {
          loadUserSessions()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [userId, loadUserSessions])

  // Sync pending invites from hook into local state
  useEffect(() => {
    if (pendingInvites) {
      setPendingCollabInvites(pendingInvites)
    }
  }, [pendingInvites])

  // Unique key for a friend — userId for existing, phoneE164 for invited
  const getFriendKey = useCallback((friend: AddedFriend): string => {
    return friend.userId || friend.phoneE164
  }, [])

  // Toggle friend selection
  const toggleFriend = useCallback((key: string) => {
    setSelectedFriendKeys((prev) => {
      const next = new Set(prev)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [])

  // Create session
  const handleCreateSession = useCallback(async () => {
    if (!sessionName.trim() || selectedFriendKeys.size === 0) return

    setCreating(true)
    try {
      // Build participant inputs
      const participants: SessionParticipantInput[] = addedFriends
        .filter((f) => selectedFriendKeys.has(getFriendKey(f)))
        .map((f) => {
          if (f.type === 'existing' && f.userId) {
            return {
              type: 'existing_user' as const,
              userId: f.userId,
              username: f.username ?? f.displayName,
            }
          }
          return {
            type: 'phone_invite' as const,
            phoneE164: f.phoneE164,
            displayName: f.displayName,
          }
        })

      const sessionId = await createCollaborativeSessionV2(
        participants,
        sessionName.trim(),
        {
          categories: userPreferences.categories,
          intents: userPreferences.intents,
          priceTiers: userPreferences.priceTiers,
          travelMode: userPreferences.travelMode,
          travelTimeMinutes: userPreferences.travelTimeMinutes,
        }
      )

      if (sessionId) {
        const selectedParticipants = addedFriends.filter((f) =>
          selectedFriendKeys.has(getFriendKey(f))
        )
        const newSession: CreatedSession = {
          name: sessionName.trim(),
          participants: selectedParticipants,
        }
        setCreatedSessions((prev) => [...prev, newSession])
        setSessionName('')
        setSelectedFriendKeys(new Set())
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
        onActionTaken()
      }
    } catch (err) {
      console.error('Error creating session:', err)
      const msg = err instanceof Error ? err.message : ''
      if (msg.toLowerCase().includes('already exists')) {
        setCreateError(t('onboarding:collaborations.name_taken_error'))
      } else {
        setCreateError(t('onboarding:collaborations.generic_error'))
      }
    } finally {
      setCreating(false)
    }
  }, [
    sessionName,
    selectedFriendKeys,
    addedFriends,
    createCollaborativeSessionV2,
    userPreferences,
    getFriendKey,
    onActionTaken,
  ])

  // Remove session
  const handleRemoveSession = useCallback((index: number) => {
    setCreatedSessions((prev) => prev.filter((_, i) => i !== index))
  }, [])

  // Accept collaboration invite
  const handleAcceptInvite = useCallback(
    async (inviteId: string) => {
      if (processingInviteId) return
      setProcessingInviteId(inviteId)
      try {
        await acceptInvite(inviteId)
        setPendingCollabInvites((prev) => prev.filter((i) => i.id !== inviteId))
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
        onActionTaken()
      } catch (err) {
        console.error('Error accepting invite:', err)
        Alert.alert(t('common:error'), err instanceof Error ? err.message : t('onboarding:collaborations.join_error'))
      } finally {
        setProcessingInviteId(null)
      }
    },
    [acceptInvite, processingInviteId, onActionTaken]
  )

  // Decline collaboration invite
  const handleDeclineInvite = useCallback(
    async (inviteId: string) => {
      if (processingInviteId) return
      setProcessingInviteId(inviteId)
      try {
        await declineInvite(inviteId)
        setPendingCollabInvites((prev) => prev.filter((i) => i.id !== inviteId))
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      } catch (err) {
        console.error('Error declining invite:', err)
        Alert.alert(t('common:error'), err instanceof Error ? err.message : t('onboarding:collaborations.decline_error'))
      } finally {
        setProcessingInviteId(null)
      }
    },
    [declineInvite, processingInviteId]
  )

  // Accept all
  const handleAcceptAllInvites = useCallback(async () => {
    try {
      await Promise.all(pendingCollabInvites.map((i) => acceptInvite(i.id)))
      setPendingCollabInvites([])
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    } catch (err) {
      console.error('Error accepting all invites:', err)
    }
  }, [pendingCollabInvites, acceptInvite])

  // Decline all
  const handleDeclineAllInvites = useCallback(async () => {
    try {
      await Promise.all(pendingCollabInvites.map((i) => declineInvite(i.id)))
      setPendingCollabInvites([])
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    } catch (err) {
      console.error('Error declining all invites:', err)
    }
  }, [pendingCollabInvites, declineInvite])

  const hasSelectedFriends = selectedFriendKeys.size > 0
  const canCreateSession = hasSelectedFriends && sessionName.trim().length > 0

  return (
    <KeyboardAwareScrollView style={styles.container} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" keyboardPadding={160}>
      <Text style={styles.headline}>{t('onboarding:collaborations.headline')}</Text>
      <Text style={styles.body}>
        {t('onboarding:collaborations.body')}
      </Text>

      {/* Friend chips */}
      <Text style={styles.sectionLabel}>{t('onboarding:collaborations.whos_in')}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipsScroll}
        contentContainerStyle={styles.chipsContent}
      >
        {addedFriends.map((friend) => {
          const key = getFriendKey(friend)
          const isSelected = selectedFriendKeys.has(key)
          return (
            <Pressable
              key={key}
              style={[
                styles.chip,
                isSelected ? styles.chipSelected : styles.chipUnselected,
              ]}
              onPress={() => toggleFriend(key)}
            >
              {friend.avatarUrl && (
                <Image
                  source={{ uri: friend.avatarUrl }}
                  style={styles.chipAvatar}
                />
              )}
              <Text
                style={[
                  styles.chipText,
                  isSelected ? styles.chipTextSelected : styles.chipTextUnselected,
                ]}
                numberOfLines={1}
              >
                {friend.displayName}
              </Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {/* Session name input */}
      {hasSelectedFriends && (
        <View style={styles.nameSection}>
          <Text style={styles.sectionLabel}>{t('onboarding:collaborations.session_name_label')}</Text>
          <TextInput
            style={styles.nameInput}
            value={sessionName}
            onChangeText={(text) => { setSessionName(text); setCreateError(null) }}
            placeholder={t('onboarding:collaborations.session_name_placeholder')}
            placeholderTextColor={colors.gray[400]}
            maxLength={50}
            autoCapitalize="sentences"
          />
        </View>
      )}

      {/* Create session button */}
      {canCreateSession && (
        <>
          <Pressable
            style={[styles.createButton, creating && styles.createButtonDisabled]}
            onPress={handleCreateSession}
            disabled={creating}
          >
            {creating ? (
              <ActivityIndicator size="small" color={colors.text.inverse} />
            ) : (
              <Text style={styles.createButtonText}>{t('common:start_session')}</Text>
            )}
          </Pressable>
          {createError && (
            <Text style={styles.createErrorText}>{createError}</Text>
          )}
        </>
      )}

      {/* Created session cards */}
      {createdSessions.length > 0 && (
        <View style={styles.sessionsSection}>
          <Text style={styles.sectionLabel}>
            {t('onboarding:collaborations.created_header', { count: createdSessions.length })}
          </Text>
          {createdSessions.map((session, index) => (
            <View key={`${session.name}-${index}`} style={styles.sessionCard}>
              <View style={styles.sessionCardHeader}>
                <Text style={styles.sessionCardName} numberOfLines={1}>
                  {session.name}
                </Text>
                <Pressable
                  onPress={() => handleRemoveSession(index)}
                  hitSlop={8}
                >
                  <Icon
                    name="close-circle"
                    size={20}
                    color={colors.gray[400]}
                  />
                </Pressable>
              </View>
              <View style={styles.avatarStack}>
                {session.participants.slice(0, 5).map((p, pIdx) => (
                  <View
                    key={p.userId || p.phoneE164}
                    style={[
                      styles.stackedAvatar,
                      { marginLeft: pIdx === 0 ? 0 : -10 },
                    ]}
                  >
                    {p.avatarUrl ? (
                      <Image
                        source={{ uri: p.avatarUrl }}
                        style={styles.stackedAvatarImage}
                      />
                    ) : (
                      <View style={styles.stackedAvatarPlaceholder}>
                        <Text style={styles.stackedAvatarText}>
                          {(p.displayName || '?').charAt(0).toUpperCase()}
                        </Text>
                      </View>
                    )}
                  </View>
                ))}
                {session.participants.length > 5 && (
                  <View style={[styles.stackedAvatar, { marginLeft: -10 }]}>
                    <View style={styles.stackedAvatarMore}>
                      <Text style={styles.stackedAvatarMoreText}>
                        +{session.participants.length - 5}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Pending collaboration invites */}
      {loadingInvites && (
        <View style={styles.loadingSection}>
          <ActivityIndicator size="small" color={colors.primary[500]} />
          <Text style={styles.loadingText}>{t('onboarding:collaborations.loading_invites')}</Text>
        </View>
      )}

      {pendingCollabInvites.length > 0 && (
        <View style={styles.invitesSection}>
          <Text style={styles.sectionLabel}>
            {t('onboarding:collaborations.invited_header', { count: pendingCollabInvites.length })}
          </Text>

          {pendingCollabInvites.length > 10 && (
            <View style={styles.bulkActions}>
              <Pressable
                style={styles.bulkButton}
                onPress={handleAcceptAllInvites}
              >
                <Text style={styles.bulkButtonTextAccept}>{t('common:accept_all')}</Text>
              </Pressable>
              <Pressable
                style={styles.bulkButton}
                onPress={handleDeclineAllInvites}
              >
                <Text style={styles.bulkButtonTextDecline}>{t('common:decline_all')}</Text>
              </Pressable>
            </View>
          )}

          {pendingCollabInvites.map((invite) => {
            const inviterName = invite.invitedBy?.name
              || t('onboarding:collaborations.fallback_someone')
            return (
              <View key={invite.id} style={styles.inviteCard}>
                <View style={styles.inviteCardHeader}>
                  <View style={styles.inviteIconContainer}>
                    <Icon name="people" size={20} color={colors.primary[500]} />
                  </View>
                  <View style={styles.inviteCardInfo}>
                    <Text style={styles.inviteCardName} numberOfLines={1}>
                      {invite.sessionName || t('onboarding:collaborations.fallback_session')}
                    </Text>
                    <Text style={styles.inviteCardFrom} numberOfLines={1}>
                      {t('onboarding:collaborations.inviter_message', { name: inviterName })}
                    </Text>
                  </View>
                </View>
                <View style={styles.inviteCardActions}>
                  <Pressable
                    style={[
                      styles.inviteJoinButton,
                      processingInviteId === invite.id && styles.inviteButtonProcessing,
                    ]}
                    onPress={() => handleAcceptInvite(invite.id)}
                    disabled={!!processingInviteId}
                  >
                    {processingInviteId === invite.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.inviteJoinButtonText}>{t('common:join')}</Text>
                    )}
                  </Pressable>
                  <Pressable
                    style={[
                      styles.inviteDeclineButton,
                      processingInviteId === invite.id && styles.inviteButtonProcessing,
                    ]}
                    onPress={() => handleDeclineInvite(invite.id)}
                    disabled={!!processingInviteId}
                  >
                    {processingInviteId === invite.id ? (
                      <ActivityIndicator size="small" color={colors.gray[500]} />
                    ) : (
                      <Text style={styles.inviteDeclineButtonText}>{t('common:decline')}</Text>
                    )}
                  </Pressable>
                </View>
              </View>
            )
          })}
        </View>
      )}

      {/* Empty state */}
      {addedFriends.length === 0 && (
        <View style={styles.emptyState}>
          <Icon
            name="chatbubbles-outline"
            size={48}
            color={colors.gray[300]}
          />
          <Text style={styles.emptyStateText}>
            {t('onboarding:collaborations.empty_state')}
          </Text>
        </View>
      )}

    </KeyboardAwareScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headline: {
    ...typography.xxl,
    fontWeight: fontWeights.bold,
    color: colors.text.primary,
    marginBottom: spacing.sm,
  },
  body: {
    ...typography.md,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.secondary,
    marginBottom: spacing.sm,
  },
  chipsScroll: {
    marginBottom: spacing.lg,
  },
  chipsContent: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.full,
    gap: spacing.xs,
  },
  chipSelected: {
    backgroundColor: colors.primary[500],
  },
  chipUnselected: {
    backgroundColor: colors.background.primary,
    borderWidth: 1,
    borderColor: colors.gray[300],
  },
  chipAvatar: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  chipText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    maxWidth: 120,
  },
  chipTextSelected: {
    color: colors.text.inverse,
  },
  chipTextUnselected: {
    color: colors.text.primary,
  },
  nameSection: {
    marginBottom: spacing.md,
  },
  nameInput: {
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[300],
    backgroundColor: colors.background.primary,
    paddingHorizontal: spacing.md,
    ...typography.md,
    color: colors.text.primary,
  },
  createButton: {
    backgroundColor: colors.primary[500],
    borderRadius: radius.md,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  createButtonDisabled: {
    opacity: 0.6,
  },
  createButtonText: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  createErrorText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.error[500],
    textAlign: 'center',
    marginTop: -spacing.sm,
    marginBottom: spacing.md,
  },
  sessionsSection: {
    marginBottom: spacing.lg,
  },
  sessionCard: {
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  sessionCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sessionCardName: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    flex: 1,
    marginRight: spacing.sm,
  },
  avatarStack: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  stackedAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: colors.background.primary,
    overflow: 'hidden',
  },
  stackedAvatarImage: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  stackedAvatarPlaceholder: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.primary[400],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackedAvatarText: {
    ...typography.xs,
    fontWeight: fontWeights.bold,
    color: colors.text.inverse,
  },
  stackedAvatarMore: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  stackedAvatarMoreText: {
    ...typography.xs,
    fontWeight: fontWeights.semibold,
    color: colors.text.secondary,
  },
  loadingSection: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  loadingText: {
    ...typography.sm,
    color: colors.text.tertiary,
  },
  invitesSection: {
    marginBottom: spacing.lg,
  },
  bulkActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  bulkButton: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.gray[300],
  },
  bulkButtonTextAccept: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.success[600],
  },
  bulkButtonTextDecline: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.error[500],
  },
  inviteCard: {
    backgroundColor: colors.primary[50],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary[200],
    padding: spacing.md,
    marginBottom: spacing.sm,
    ...shadows.sm,
  },
  inviteCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  inviteIconContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteCardInfo: {
    flex: 1,
  },
  inviteCardName: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  inviteCardFrom: {
    ...typography.sm,
    color: colors.primary[600],
    marginTop: 2,
  },
  inviteCardActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inviteJoinButton: {
    flex: 1,
    backgroundColor: colors.primary[500],
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteJoinButtonText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  inviteDeclineButton: {
    flex: 1,
    backgroundColor: colors.background.primary,
    paddingVertical: spacing.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteDeclineButtonText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    color: colors.text.secondary,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    gap: spacing.md,
  },
  emptyStateText: {
    ...typography.sm,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    textAlign: 'center',
  },
  inviteButtonProcessing: {
    opacity: 0.6,
  },
})
