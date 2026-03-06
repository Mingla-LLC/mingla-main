import React, { useState, useEffect, useCallback } from 'react'
import {
  View,
  Text,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Image,
  Share,
  StyleSheet,
} from 'react-native'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'

import { PhoneInput } from './PhoneInput'
import { useFriends } from '../../hooks/useFriends'
import { usePhoneLookup, useDebouncedValue } from '../../hooks/usePhoneLookup'
import { createPendingInvite } from '../../services/phoneLookupService'
import { supabase } from '../../services/supabase'
import { getCountryByCode, getDefaultCountryCode } from '../../constants/countries'
import { AddedFriend } from '../../types/onboarding'
import {
  colors,
  typography,
  fontWeights,
  spacing,
  radius,
  shadows,
} from '../../constants/designSystem'

interface OnboardingFriendsStepProps {
  userId: string
  onContinue: (addedFriends: AddedFriend[]) => void
  onSkip: () => void
}

export const OnboardingFriendsStep: React.FC<OnboardingFriendsStepProps> = ({
  userId,
  onContinue,
  onSkip,
}) => {
  // Phone input state
  const [phoneDigits, setPhoneDigits] = useState('')
  const [phoneCountry, setPhoneCountry] = useState(getDefaultCountryCode())

  // Added friends
  const [addedFriends, setAddedFriends] = useState<AddedFriend[]>([])

  // Referral code
  const [referralCode, setReferralCode] = useState<string | null>(null)

  // Invite loading
  const [inviteLoading, setInviteLoading] = useState(false)

  // Friends hook
  const {
    friendRequests,
    loading: friendsLoading,
    loadFriendRequests,
    acceptFriendRequest,
    declineFriendRequest,
  } = useFriends({ autoFetchBlockedUsers: false })

  // Build E.164 phone
  const country = getCountryByCode(phoneCountry)
  const rawDigits = phoneDigits.replace(/\D/g, '')
  const phoneE164 = country ? country.dialCode + rawDigits : '+1' + rawDigits

  // Debounce phone input
  const debouncedPhone = useDebouncedValue(phoneE164, 500)

  // Phone lookup
  const {
    data: lookupResult,
    isLoading: lookupLoading,
    isError: lookupError,
  } = usePhoneLookup(debouncedPhone, rawDigits.length >= 7)

  // Pending incoming requests
  const incomingRequests = friendRequests.filter((r) => r.type === 'incoming')

  // All pending resolved check
  const allPendingResolved = incomingRequests.length === 0

  // Can continue
  const canContinue = addedFriends.length > 0 && allPendingResolved

  // Check if phone is already added
  const isAlreadyAdded = addedFriends.some((f) => f.phoneE164 === debouncedPhone)

  // Load friend requests on mount
  useEffect(() => {
    loadFriendRequests()
  }, [loadFriendRequests])

  // Load referral code
  useEffect(() => {
    const fetchReferralCode = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('referral_code')
          .eq('id', userId)
          .single()

        if (!error && data?.referral_code) {
          setReferralCode(data.referral_code)
        }
      } catch (err) {
        console.error('Error fetching referral code:', err)
      }
    }
    fetchReferralCode()
  }, [userId])

  // Clear input helper
  const clearInput = useCallback(() => {
    setPhoneDigits('')
  }, [])

  // Handle add existing user
  const handleAddExisting = useCallback(() => {
    if (!lookupResult?.found || !lookupResult.user) return

    const friend: AddedFriend = {
      type: 'existing',
      userId: lookupResult.user.id,
      username: lookupResult.user.username,
      phoneE164: debouncedPhone,
      displayName:
        lookupResult.user.display_name ||
        (lookupResult.user.first_name && lookupResult.user.last_name
          ? `${lookupResult.user.first_name} ${lookupResult.user.last_name}`
          : lookupResult.user.username),
      avatarUrl: lookupResult.user.avatar_url,
      friendshipStatus: lookupResult.friendship_status,
    }

    setAddedFriends((prev) => [...prev, friend])
    clearInput()
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
  }, [lookupResult, debouncedPhone, clearInput])

  // Handle invite non-user
  const handleInvite = useCallback(async () => {
    setInviteLoading(true)
    try {
      await createPendingInvite(userId, debouncedPhone)

      const inviteLink = referralCode
        ? `https://usemingla.com/invite/${referralCode}`
        : 'https://usemingla.com'

      await Share.share({
        message: `Hey! Join me on Mingla and let's find amazing experiences together. ${inviteLink}`,
      })

      // Add as invited regardless of share result
      const friend: AddedFriend = {
        type: 'invited',
        phoneE164: debouncedPhone,
        displayName: debouncedPhone,
        avatarUrl: null,
        friendshipStatus: 'none',
      }

      setAddedFriends((prev) => [...prev, friend])
      clearInput()
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    } catch (err) {
      console.error('Error creating invite:', err)
    } finally {
      setInviteLoading(false)
    }
  }, [userId, debouncedPhone, referralCode, clearInput])

  // Handle remove friend — use userId for existing users, phoneE164 for invited
  const handleRemoveFriend = useCallback((friend: AddedFriend) => {
    setAddedFriends((prev) =>
      prev.filter((f) => {
        if (friend.userId) return f.userId !== friend.userId
        return f.phoneE164 !== friend.phoneE164
      })
    )
  }, [])

  // Handle accept request
  const handleAcceptRequest = useCallback(
    async (requestId: string) => {
      try {
        const request = incomingRequests.find((r) => r.id === requestId)
        await acceptFriendRequest(requestId)

        // Add accepted user to addedFriends
        if (request) {
          const acceptedFriend: AddedFriend = {
            type: 'existing',
            userId: request.sender_id,
            username: request.sender.username,
            phoneE164: '',
            displayName:
              request.sender.display_name ||
              (request.sender.first_name && request.sender.last_name
                ? `${request.sender.first_name} ${request.sender.last_name}`
                : request.sender.username),
            avatarUrl: request.sender.avatar_url ?? null,
            friendshipStatus: 'friends',
          }
          setAddedFriends((prev) => [...prev, acceptedFriend])
        }

        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      } catch (err) {
        console.error('Error accepting friend request:', err)
      }
    },
    [acceptFriendRequest, incomingRequests]
  )

  // Handle decline request
  const handleDeclineRequest = useCallback(
    async (requestId: string) => {
      try {
        await declineFriendRequest(requestId)
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      } catch (err) {
        console.error('Error declining friend request:', err)
      }
    },
    [declineFriendRequest]
  )

  // Handle accept all
  const handleAcceptAll = useCallback(async () => {
    try {
      await Promise.all(incomingRequests.map((r) => acceptFriendRequest(r.id)))

      // Add all accepted users to addedFriends
      const acceptedFriends: AddedFriend[] = incomingRequests.map((request) => ({
        type: 'existing' as const,
        userId: request.sender_id,
        username: request.sender.username,
        phoneE164: '',
        displayName:
          request.sender.display_name ||
          (request.sender.first_name && request.sender.last_name
            ? `${request.sender.first_name} ${request.sender.last_name}`
            : request.sender.username),
        avatarUrl: request.sender.avatar_url ?? null,
        friendshipStatus: 'friends' as const,
      }))
      setAddedFriends((prev) => [...prev, ...acceptedFriends])

      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    } catch (err) {
      console.error('Error accepting all requests:', err)
    }
  }, [incomingRequests, acceptFriendRequest])

  // Handle decline all
  const handleDeclineAll = useCallback(async () => {
    try {
      await Promise.all(incomingRequests.map((r) => declineFriendRequest(r.id)))
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
    } catch (err) {
      console.error('Error declining all requests:', err)
    }
  }, [incomingRequests, declineFriendRequest])

  // Determine action button state
  const renderActionButton = () => {
    if (lookupLoading || inviteLoading) {
      return (
        <View style={styles.actionButton}>
          <ActivityIndicator size="small" color={colors.primary[500]} />
        </View>
      )
    }

    if (isAlreadyAdded) {
      return (
        <View style={[styles.actionButton, styles.actionButtonDone]}>
          <Ionicons name="checkmark" size={20} color={colors.success[500]} />
        </View>
      )
    }

    if (rawDigits.length < 7) {
      return null
    }

    if (lookupResult?.found && lookupResult.user) {
      return (
        <Pressable
          style={[styles.actionButton, styles.actionButtonAdd]}
          onPress={handleAddExisting}
        >
          <Ionicons name="add" size={22} color={colors.text.inverse} />
        </Pressable>
      )
    }

    return (
      <Pressable
        style={[styles.actionButton, styles.actionButtonInvite]}
        onPress={handleInvite}
      >
        <Text style={styles.actionButtonInviteText}>Invite</Text>
      </Pressable>
    )
  }

  return (
    <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
      <Text style={styles.headline}>Add friends</Text>
      <Text style={styles.body}>
        Find friends on Mingla or invite them by phone number.
      </Text>

      {/* Phone input row */}
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
        {renderActionButton()}
      </View>

      {/* Lookup result dropdown */}
      {rawDigits.length >= 7 &&
        !lookupLoading &&
        !isAlreadyAdded &&
        lookupResult?.found &&
        lookupResult.user && (
          <Pressable style={styles.lookupResult} onPress={handleAddExisting}>
            <View style={styles.lookupAvatar}>
              {lookupResult.user.avatar_url ? (
                <Image
                  source={{ uri: lookupResult.user.avatar_url }}
                  style={styles.lookupAvatarImage}
                />
              ) : (
                <View style={styles.lookupAvatarPlaceholder}>
                  <Ionicons name="person" size={16} color={colors.text.inverse} />
                </View>
              )}
            </View>
            <View style={styles.lookupInfo}>
              <Text style={styles.lookupName} numberOfLines={1}>
                {lookupResult.user.display_name ||
                  (lookupResult.user.first_name && lookupResult.user.last_name
                    ? `${lookupResult.user.first_name} ${lookupResult.user.last_name}`
                    : lookupResult.user.username)}
              </Text>
              <Text style={styles.lookupUsername} numberOfLines={1}>
                @{lookupResult.user.username}
              </Text>
            </View>
            <Ionicons name="add-circle" size={24} color={colors.primary[500]} />
          </Pressable>
        )}

      {/* Lookup error */}
      {lookupError && rawDigits.length >= 7 && (
        <Text style={styles.errorText}>Unable to search. Please try again.</Text>
      )}

      {/* Added friends pills */}
      {addedFriends.length > 0 && (
        <View style={styles.pillsSection}>
          <Text style={styles.sectionLabel}>Added</Text>
          <View style={styles.pillsWrap}>
            {addedFriends.map((friend) => (
              <View
                key={friend.userId || friend.phoneE164}
                style={[
                  styles.pill,
                  friend.type === 'existing' ? styles.pillExisting : styles.pillInvited,
                ]}
              >
                {friend.type === 'existing' && friend.avatarUrl && (
                  <Image
                    source={{ uri: friend.avatarUrl }}
                    style={styles.pillAvatar}
                  />
                )}
                <Text
                  style={[
                    styles.pillText,
                    friend.type === 'existing'
                      ? styles.pillTextExisting
                      : styles.pillTextInvited,
                  ]}
                  numberOfLines={1}
                >
                  {friend.type === 'existing'
                    ? friend.displayName
                    : friend.phoneE164}
                </Text>
                <Pressable
                  onPress={() => handleRemoveFriend(friend)}
                  hitSlop={8}
                >
                  <Ionicons
                    name="close-circle"
                    size={16}
                    color={
                      friend.type === 'existing'
                        ? colors.primary[700]
                        : colors.orange[600]
                    }
                  />
                </Pressable>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Pending friend requests */}
      {friendsLoading && incomingRequests.length === 0 && (
        <View style={styles.loadingSection}>
          <ActivityIndicator size="small" color={colors.primary[500]} />
          <Text style={styles.loadingText}>Loading friend requests...</Text>
        </View>
      )}

      {incomingRequests.length > 0 && (
        <View style={styles.requestsSection}>
          <Text style={styles.sectionLabel}>
            Pending friend requests ({incomingRequests.length})
          </Text>

          {incomingRequests.length > 10 && (
            <View style={styles.bulkActions}>
              <Pressable style={styles.bulkButton} onPress={handleAcceptAll}>
                <Text style={styles.bulkButtonTextAccept}>Accept All</Text>
              </Pressable>
              <Pressable style={styles.bulkButton} onPress={handleDeclineAll}>
                <Text style={styles.bulkButtonTextDecline}>Decline All</Text>
              </Pressable>
            </View>
          )}

          {incomingRequests.map((request) => (
            <View key={request.id} style={styles.requestRow}>
              <View style={styles.requestAvatar}>
                {request.sender.avatar_url ? (
                  <Image
                    source={{ uri: request.sender.avatar_url }}
                    style={styles.requestAvatarImage}
                  />
                ) : (
                  <View style={styles.requestAvatarPlaceholder}>
                    <Text style={styles.requestAvatarText}>
                      {(request.sender.display_name || request.sender.username || '?')
                        .charAt(0)
                        .toUpperCase()}
                    </Text>
                  </View>
                )}
              </View>
              <View style={styles.requestInfo}>
                <Text style={styles.requestName} numberOfLines={1}>
                  {request.sender.display_name || request.sender.username}
                </Text>
                <Text style={styles.requestUsername} numberOfLines={1}>
                  @{request.sender.username}
                </Text>
              </View>
              <View style={styles.requestActions}>
                <Pressable
                  style={styles.acceptButton}
                  onPress={() => handleAcceptRequest(request.id)}
                >
                  <Text style={styles.acceptButtonText}>Accept</Text>
                </Pressable>
                <Pressable
                  style={styles.declineButton}
                  onPress={() => handleDeclineRequest(request.id)}
                >
                  <Text style={styles.declineButtonText}>Decline</Text>
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Empty state */}
      {!friendsLoading &&
        incomingRequests.length === 0 &&
        addedFriends.length === 0 &&
        rawDigits.length === 0 && (
          <View style={styles.emptyState}>
            <Ionicons
              name="people-outline"
              size={48}
              color={colors.gray[300]}
            />
            <Text style={styles.emptyStateText}>
              Enter a phone number to find or invite friends
            </Text>
          </View>
        )}

      {/* Continue button */}
      {canContinue && (
        <Pressable
          style={styles.continueButton}
          onPress={() => onContinue(addedFriends)}
        >
          <Text style={styles.continueButtonText}>Continue</Text>
        </Pressable>
      )}

      {/* Skip button */}
      <Pressable style={styles.skipButton} onPress={onSkip}>
        <Text style={styles.skipButtonText}>Skip for now</Text>
      </Pressable>
    </ScrollView>
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
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  phoneInputWrapper: {
    flex: 1,
  },
  actionButton: {
    width: 48,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
  },
  actionButtonAdd: {
    backgroundColor: colors.primary[500],
  },
  actionButtonInvite: {
    backgroundColor: colors.primary[50],
    borderWidth: 1,
    borderColor: colors.primary[300],
  },
  actionButtonDone: {
    backgroundColor: colors.success[50],
    borderWidth: 1,
    borderColor: colors.success[300],
  },
  actionButtonInviteText: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.primary[600],
  },
  lookupResult: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    padding: spacing.md,
    marginBottom: spacing.md,
    ...shadows.sm,
  },
  lookupAvatar: {
    marginRight: spacing.sm,
  },
  lookupAvatarImage: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  lookupAvatarPlaceholder: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary[400],
    alignItems: 'center',
    justifyContent: 'center',
  },
  lookupInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  lookupName: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  lookupUsername: {
    ...typography.xs,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  errorText: {
    ...typography.sm,
    color: colors.error[500],
    marginBottom: spacing.md,
  },
  pillsSection: {
    marginBottom: spacing.lg,
  },
  sectionLabel: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.secondary,
    marginBottom: spacing.sm,
  },
  pillsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.full,
    gap: spacing.xs,
    maxWidth: '100%',
  },
  pillExisting: {
    backgroundColor: colors.primary[100],
  },
  pillInvited: {
    backgroundColor: colors.warning[50],
  },
  pillAvatar: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  pillText: {
    ...typography.sm,
    fontWeight: fontWeights.medium,
    maxWidth: 150,
  },
  pillTextExisting: {
    color: colors.primary[700],
  },
  pillTextInvited: {
    color: colors.orange[600],
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
  requestsSection: {
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
  requestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background.primary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gray[200],
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  requestAvatar: {
    marginRight: spacing.sm,
  },
  requestAvatarImage: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  requestAvatarPlaceholder: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primary[400],
    alignItems: 'center',
    justifyContent: 'center',
  },
  requestAvatarText: {
    ...typography.md,
    fontWeight: fontWeights.bold,
    color: colors.text.inverse,
  },
  requestInfo: {
    flex: 1,
    marginRight: spacing.sm,
  },
  requestName: {
    ...typography.sm,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
  },
  requestUsername: {
    ...typography.xs,
    fontWeight: fontWeights.regular,
    color: colors.text.tertiary,
    marginTop: 2,
  },
  requestActions: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  acceptButton: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  acceptButtonText: {
    ...typography.xs,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  declineButton: {
    backgroundColor: colors.gray[100],
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  declineButtonText: {
    ...typography.xs,
    fontWeight: fontWeights.semibold,
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
  continueButton: {
    backgroundColor: colors.primary[500],
    borderRadius: radius.lg,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  continueButtonText: {
    ...typography.md,
    fontWeight: fontWeights.semibold,
    color: colors.text.inverse,
  },
  skipButton: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
  },
  skipButtonText: {
    ...typography.md,
    fontWeight: fontWeights.medium,
    color: colors.text.tertiary,
  },
})
