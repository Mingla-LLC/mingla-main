import React, { useState, useCallback } from 'react'
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  Alert,
  Share,
  ActivityIndicator,
  Image,
  StyleSheet,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { Icon } from '../ui/Icon'

import { PhoneInput } from './PhoneInput'
import { usePhoneLookup, useDebouncedValue } from '../../hooks/usePhoneLookup'
import { createPendingInvite } from '../../services/phoneLookupService'
import { supabase } from '../../services/supabase'
import { AddedFriend } from '../../types/onboarding'
import { FriendRequest } from '../../services/friendsService'
import { getDefaultCountryCode, getCountryByCode } from '../../constants/countries'
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
} from '../../constants/designSystem'

interface OnboardingFriendsStepProps {
  userId: string
  userPhoneE164: string
  addedFriends: AddedFriend[]
  onAddFriend: (friend: AddedFriend) => void
  onRemoveFriend: (phoneE164: string) => void
  onContinue: () => void
  onSkip: () => void
  incomingRequests: FriendRequest[]
  onAcceptRequest: (requestId: string) => Promise<void>
  onDeclineRequest: (requestId: string) => Promise<void>
}

export const OnboardingFriendsStep: React.FC<OnboardingFriendsStepProps> = ({
  userId,
  userPhoneE164,
  addedFriends,
  onAddFriend,
  onRemoveFriend,
  onContinue,
  onSkip,
  incomingRequests,
  onAcceptRequest,
  onDeclineRequest,
}) => {
  const [phoneDigits, setPhoneDigits] = useState('')
  const [phoneCountry, setPhoneCountry] = useState(getDefaultCountryCode())
  const [actionLoading, setActionLoading] = useState(false)

  // Track which request is currently being processed (accept/decline in-flight)
  const [processingRequestId, setProcessingRequestId] = useState<string | null>(null)
  // Track visual feedback state per request after accept/decline completes
  const [processedRequests, setProcessedRequests] = useState<Record<string, 'accepted' | 'declined'>>({})

  // Build E.164 from country + digits
  const countryData = getCountryByCode(phoneCountry)
  const rawDigits = phoneDigits.replace(/\D/g, '')
  const phoneE164 = countryData ? `${countryData.dialCode}${rawDigits}` : `+${rawDigits}`
  const debouncedPhoneE164 = useDebouncedValue(phoneE164, 500)
  const isPhoneValid = /^\+[1-9]\d{6,14}$/.test(debouncedPhoneE164)

  const {
    data: phoneLookupResult,
    isLoading: phoneLookupLoading,
  } = usePhoneLookup(debouncedPhoneE164, isPhoneValid)

  const handlePhoneAction = useCallback(async () => {
    if (!isPhoneValid || actionLoading) return
    setActionLoading(true)

    try {
      // Self-check
      if (debouncedPhoneE164 === userPhoneE164) {
        Alert.alert("That's you", "You can't add yourself as a friend.")
        return
      }

      // Already added check
      if (addedFriends.some(f => f.phoneE164 === debouncedPhoneE164)) {
        Alert.alert('Already added', 'This person is already in your list.')
        return
      }

      if (phoneLookupResult?.found && phoneLookupResult.user) {
        const lookupUser = phoneLookupResult.user
        // Existing Mingla user — add as friend
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)

        // Send friend request
        await supabase
          .from('friend_requests')
          .upsert(
            { sender_id: userId, receiver_id: lookupUser.id, status: 'pending' },
            { onConflict: 'sender_id,receiver_id' }
          )

        onAddFriend({
          type: 'existing',
          userId: lookupUser.id,
          username: lookupUser.username,
          phoneE164: debouncedPhoneE164,
          displayName: lookupUser.display_name || lookupUser.username || 'User',
          avatarUrl: lookupUser.avatar_url,
          friendshipStatus: phoneLookupResult.friendship_status === 'friends'
            ? 'friends'
            : 'pending_sent',
        })

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setPhoneDigits('')
      } else {
        // Not on Mingla — create pending invite + share
        await createPendingInvite(userId, debouncedPhoneE164)

        onAddFriend({
          type: 'invited',
          phoneE164: debouncedPhoneE164,
          displayName: debouncedPhoneE164,
          friendshipStatus: 'none',
        })

        await Share.share({
          message: `Hey! Join me on Mingla and let's find amazing experiences together. https://usemingla.com`,
        })

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
        setPhoneDigits('')
      }
    } catch (err) {
      console.error('[OnboardingFriendsStep] Phone action error:', err)
      Alert.alert('Error', err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setActionLoading(false)
    }
  }, [isPhoneValid, actionLoading, debouncedPhoneE164, userPhoneE164, phoneLookupResult, userId, addedFriends, onAddFriend])

  const handleAccept = useCallback(async (requestId: string) => {
    if (processingRequestId) return // prevent concurrent processing
    setProcessingRequestId(requestId)
    try {
      await onAcceptRequest(requestId)
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setProcessedRequests(prev => ({ ...prev, [requestId]: 'accepted' }))
      // Remove from visual list after feedback delay
      setTimeout(() => {
        setProcessedRequests(prev => {
          const next = { ...prev }
          delete next[requestId]
          return next
        })
      }, 800)
    } catch {
      Alert.alert('Something went wrong', "Couldn't process the request. Try again.")
    } finally {
      setProcessingRequestId(null)
    }
  }, [processingRequestId, onAcceptRequest])

  const handleDecline = useCallback(async (requestId: string) => {
    if (processingRequestId) return
    setProcessingRequestId(requestId)
    try {
      await onDeclineRequest(requestId)
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      setProcessedRequests(prev => ({ ...prev, [requestId]: 'declined' }))
      setTimeout(() => {
        setProcessedRequests(prev => {
          const next = { ...prev }
          delete next[requestId]
          return next
        })
      }, 800)
    } catch {
      Alert.alert('Something went wrong', "Couldn't process the request. Try again.")
    } finally {
      setProcessingRequestId(null)
    }
  }, [processingRequestId, onDeclineRequest])

  const getButtonLabel = (): string => {
    if (phoneLookupLoading) return 'Looking up...'
    if (!isPhoneValid) return 'Enter phone number'
    if (phoneLookupResult?.found) return 'Add Friend'
    return 'Invite to Mingla'
  }

  const isButtonDisabled =
    !isPhoneValid ||
    phoneLookupLoading ||
    actionLoading ||
    debouncedPhoneE164 === userPhoneE164 ||
    addedFriends.some(f => f.phoneE164 === debouncedPhoneE164)

  const visibleRequests = incomingRequests

  return (
    <View style={styles.container}>
      <Text style={styles.headline}>Add friends</Text>
      <Text style={styles.subtitle}>
        Find people you know on Mingla, or invite them to join.
      </Text>

      {/* Incoming Friend Requests — only renders when there are requests */}
      {visibleRequests.length > 0 && (
        <View style={styles.incomingSection}>
          <Text style={styles.incomingSectionLabel}>Friend Requests</Text>
          {visibleRequests.map((request) => {
            const status = processedRequests[request.id]
            const isProcessing = processingRequestId === request.id
            const senderName =
              request.sender?.display_name ||
              (request.sender?.first_name && request.sender?.last_name
                ? `${request.sender.first_name} ${request.sender.last_name}`
                : null) ||
              'Someone'
            const initials = senderName
              .split(' ')
              .map((n) => n[0])
              .join('')
              .toUpperCase()
              .slice(0, 2)

            // Accepted feedback state
            if (status === 'accepted') {
              return (
                <View key={request.id} style={[styles.requestCard, styles.requestCardAccepted]}>
                  <Icon name="checkmark-circle" size={20} color={colors.success?.[600] ?? '#059669'} />
                  <Text style={styles.acceptedText}>Added</Text>
                </View>
              )
            }

            // Declined feedback state
            if (status === 'declined') {
              return (
                <View key={request.id} style={[styles.requestCard, styles.requestCardDeclined]}>
                  <Icon name="close-circle" size={20} color={colors.gray[500]} />
                  <Text style={styles.declinedText}>Declined</Text>
                </View>
              )
            }

            return (
              <View key={request.id} style={styles.requestCard}>
                {/* Avatar */}
                {request.sender?.avatar_url ? (
                  <Image
                    source={{ uri: request.sender.avatar_url }}
                    style={styles.requestAvatar}
                  />
                ) : (
                  <View style={styles.requestAvatarPlaceholder}>
                    <Text style={styles.requestAvatarInitials}>{initials}</Text>
                  </View>
                )}

                {/* Info */}
                <View style={styles.requestInfo}>
                  <Text style={styles.requestName} numberOfLines={1}>{senderName}</Text>
                </View>

                {/* Buttons */}
                <View style={styles.requestButtons}>
                  <TouchableOpacity
                    style={styles.acceptButton}
                    onPress={() => handleAccept(request.id)}
                    disabled={!!processingRequestId}
                    activeOpacity={0.7}
                  >
                    {isProcessing && processingRequestId === request.id ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.acceptButtonText}>Accept</Text>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.declineButton}
                    onPress={() => handleDecline(request.id)}
                    disabled={!!processingRequestId}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.declineButtonText}>Decline</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )
          })}
        </View>
      )}

      {/* Phone Input */}
      <View style={styles.phoneRow}>
        <View style={styles.phoneInputWrapper}>
          <PhoneInput
            value={phoneDigits}
            countryCode={phoneCountry}
            onChangePhone={setPhoneDigits}
            onChangeCountry={setPhoneCountry}
            error={null}
            disabled={false}
          />
        </View>
      </View>

      {/* Lookup result + action button */}
      {isPhoneValid && (
        <View style={styles.lookupRow}>
          {phoneLookupLoading ? (
            <ActivityIndicator size="small" color={colors.primary[500]} />
          ) : phoneLookupResult?.found && phoneLookupResult.user ? (
            <View style={styles.lookupUserRow}>
              {phoneLookupResult.user.avatar_url ? (
                <Image
                  source={{ uri: phoneLookupResult.user.avatar_url }}
                  style={styles.avatar}
                />
              ) : (
                <View style={styles.avatarPlaceholder}>
                  <Icon name="person" size={18} color={colors.gray[400]} />
                </View>
              )}
              <Text style={styles.lookupName} numberOfLines={1}>
                {phoneLookupResult.user.display_name || 'Someone'}
              </Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.actionButton, isButtonDisabled && styles.actionButtonDisabled]}
            onPress={handlePhoneAction}
            disabled={isButtonDisabled}
            activeOpacity={0.7}
          >
            {actionLoading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.actionButtonText}>{getButtonLabel()}</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Added friends list */}
      {addedFriends.length > 0 && (
        <ScrollView style={styles.friendsList} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {addedFriends.map((friend) => (
            <View key={friend.phoneE164} style={styles.friendRow}>
              <View style={styles.friendInfo}>
                {friend.avatarUrl ? (
                  <Image source={{ uri: friend.avatarUrl }} style={styles.friendAvatar} />
                ) : (
                  <View style={styles.friendAvatarPlaceholder}>
                    <Icon name="person" size={14} color={colors.gray[400]} />
                  </View>
                )}
                <View style={styles.friendTextCol}>
                  <Text style={styles.friendName} numberOfLines={1}>
                    {friend.displayName}
                  </Text>
                  <Text style={styles.friendType}>
                    {friend.type === 'existing' ? 'Friend request sent' : 'Invited to Mingla'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => onRemoveFriend(friend.phoneE164)}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              >
                <Icon name="close-circle" size={22} color={colors.gray[400]} />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>
      )}

      {/* Actions */}
      <View style={styles.actions}>
        <TouchableOpacity
          style={styles.continueButton}
          onPress={onContinue}
          activeOpacity={0.7}
        >
          <Text style={styles.continueButtonText}>Continue</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={onSkip} activeOpacity={0.7}>
          <Text style={styles.skipText}>Skip</Text>
        </TouchableOpacity>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  headline: {
    fontSize: typography.xxl.fontSize,
    fontWeight: fontWeights.bold as any,
    color: colors.gray[900],
    marginBottom: spacing.xs,
  },
  subtitle: {
    fontSize: typography.md.fontSize,
    color: colors.gray[500],
    marginBottom: spacing.lg,
    lineHeight: 22,
  },
  // ─── Incoming Requests Section ───
  incomingSection: {
    marginBottom: spacing.lg,
  },
  incomingSectionLabel: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
    color: colors.gray[600],
    marginBottom: spacing.sm,
  },
  requestCard: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    backgroundColor: colors.background?.primary ?? '#ffffff',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  requestCardAccepted: {
    backgroundColor: colors.success?.[50] ?? '#f0fdf4',
    borderColor: colors.success?.[200] ?? '#bbf7d0',
    justifyContent: 'center',
  },
  requestCardDeclined: {
    backgroundColor: colors.gray[50],
    borderColor: colors.gray[200],
    justifyContent: 'center',
  },
  acceptedText: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
    color: colors.success?.[600] ?? '#059669',
  },
  declinedText: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
    color: colors.gray[500],
  },
  requestAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  requestAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[500],
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestAvatarInitials: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  requestInfo: {
    flex: 1,
  },
  requestName: {
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
    color: colors.text?.primary ?? colors.gray[900],
  },
  requestUsername: {
    fontSize: typography.xs.fontSize,
    color: colors.text?.tertiary ?? colors.gray[400],
    marginTop: 1,
  },
  requestButtons: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  acceptButton: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptButtonText: {
    color: '#ffffff',
    fontSize: typography.xs.fontSize,
    fontWeight: fontWeights.semibold as any,
  },
  declineButton: {
    backgroundColor: colors.gray[100],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  declineButtonText: {
    color: colors.gray[600],
    fontSize: typography.xs.fontSize,
    fontWeight: fontWeights.semibold as any,
  },
  // ─── Existing Styles ───
  phoneRow: {
    marginBottom: spacing.md,
  },
  phoneInputWrapper: {
    width: '100%',
  },
  lookupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
    gap: spacing.sm,
  },
  lookupUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  avatarPlaceholder: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookupName: {
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.medium as any,
    color: colors.gray[800],
    flex: 1,
  },
  actionButton: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    minWidth: 120,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: typography.sm.fontSize,
    fontWeight: fontWeights.semibold as any,
  },
  friendsList: {
    flex: 1,
    marginTop: spacing.sm,
  },
  friendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.gray[100],
  },
  friendInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: spacing.sm,
  },
  friendAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  friendAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gray[100],
    alignItems: 'center',
    justifyContent: 'center',
  },
  friendTextCol: {
    flex: 1,
  },
  friendName: {
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.medium as any,
    color: colors.gray[800],
  },
  friendType: {
    fontSize: typography.xs.fontSize,
    color: colors.gray[400],
    marginTop: 2,
  },
  actions: {
    paddingVertical: spacing.lg,
    alignItems: 'center',
    gap: spacing.md,
  },
  continueButton: {
    backgroundColor: colors.primary[500],
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.lg,
    width: '100%',
    alignItems: 'center',
  },
  continueButtonText: {
    color: '#fff',
    fontSize: typography.md.fontSize,
    fontWeight: fontWeights.semibold as any,
  },
  skipText: {
    fontSize: typography.md.fontSize,
    color: colors.gray[400],
  },
})
