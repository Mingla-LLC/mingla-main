import React, { forwardRef, useState, useEffect } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { BlurView } from 'expo-blur';
import { Icon } from '../ui/Icon';
import type { NearbyPerson } from '../../hooks/useNearbyPeople';

interface PersonBottomSheetProps {
  person: NearbyPerson | null;
  onClose: () => void;
  onMessage: (userId: string) => void;
  onInviteToSession: (userId: string) => void;
  onViewPairedCards: (userId: string) => void;
  onViewProfile: (userId: string) => void;
  onAddFriend: (userId: string) => void | Promise<void>;
  onBlock: (userId: string) => void;
  onReport: (userId: string) => void;
}

const snapPoints = ['40%'];

export const PersonBottomSheet = forwardRef<BottomSheet, PersonBottomSheetProps>(
  ({ person, onClose, onMessage, onInviteToSession, onViewPairedCards, onViewProfile, onAddFriend, onBlock, onReport }, ref) => {
    const [friendRequestSending, setFriendRequestSending] = useState(false);
    const [friendRequestSent, setFriendRequestSent] = useState(false);

    // Reset state when person changes (new bottom sheet opened)
    useEffect(() => {
      setFriendRequestSending(false);
      setFriendRequestSent(false);
    }, [person?.userId]);

    const handleAddFriendPress = async (userId: string) => {
      setFriendRequestSending(true);
      try {
        await onAddFriend(userId);
        setFriendRequestSent(true);
      } finally {
        setFriendRequestSending(false);
      }
    };

    return (
      <BottomSheet
        ref={ref}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        onClose={onClose}
        handleIndicatorStyle={styles.handle}
        backgroundStyle={styles.sheetBackground}
      >
        <BottomSheetScrollView contentContainerStyle={styles.scrollContent}>
          {person && (
            <View style={styles.content}>
              <View style={styles.header}>
                {person.avatarUrl ? (
                  <Image source={{ uri: person.avatarUrl }} style={styles.avatar} />
                ) : (
                  <View style={styles.avatarFallback}>
                    <Text style={styles.avatarInitials}>
                      {(person.firstName || person.displayName || '?')[0].toUpperCase()}
                    </Text>
                  </View>
                )}
                <View style={styles.headerText}>
                  <Text style={styles.name}>{person.displayName}</Text>
                  <Text style={styles.relationship}>
                    {person.relationship === 'paired' ? 'Your pair'
                      : person.relationship === 'friend' ? 'Friend'
                      : 'Nearby'}
                  </Text>
                  {person.activityStatus && (
                    <Text style={styles.status}>{person.activityStatus}</Text>
                  )}
                </View>
              </View>

              {/* Taste match section — strangers only, hidden for seeds */}
              {person.relationship === 'stranger' && !person.isSeed && person.tasteMatchPct != null && (
                <View style={styles.tasteMatchSection}>
                  <Text style={styles.matchPctLarge}>{person.tasteMatchPct}%</Text>
                  <Text style={styles.matchLabel}>taste match</Text>
                  {person.sharedCategories.length > 0 && (
                    <Text style={styles.sharedValues}>
                      You both enjoy {person.sharedCategories.join(', ')}
                    </Text>
                  )}
                </View>
              )}

              {/* Action buttons — friends/paired get Message + Invite/Cards + Profile; strangers get Profile only */}
              {!person.isSeed && (
              <View style={styles.actionRow}>
                {(person.relationship === 'friend' || person.relationship === 'paired') && (
                  <TouchableOpacity style={styles.actionWrapper} onPress={() => onMessage(person.userId)} activeOpacity={0.7}>
                    <BlurView intensity={40} tint="light" style={styles.blurButton}>
                      <Icon name="chatbubble-outline" size={18} color="#111" />
                      <Text style={styles.actionText}>Message</Text>
                    </BlurView>
                  </TouchableOpacity>
                )}
                {person.relationship === 'friend' && (
                  <TouchableOpacity style={styles.actionWrapper} onPress={() => onInviteToSession(person.userId)} activeOpacity={0.7}>
                    <BlurView intensity={40} tint="light" style={styles.blurButton}>
                      <Icon name="people-outline" size={18} color="#111" />
                      <Text style={styles.actionText}>Invite</Text>
                    </BlurView>
                  </TouchableOpacity>
                )}
                {person.relationship === 'paired' && (
                  <TouchableOpacity style={styles.actionWrapper} onPress={() => onViewPairedCards(person.userId)} activeOpacity={0.7}>
                    <BlurView intensity={40} tint="light" style={styles.blurButton}>
                      <Icon name="heart-outline" size={18} color="#111" />
                      <Text style={styles.actionText}>Cards</Text>
                    </BlurView>
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={styles.actionWrapper} onPress={() => onViewProfile(person.userId)} activeOpacity={0.7}>
                  <BlurView intensity={40} tint="light" style={styles.blurButton}>
                    <Icon name="person-outline" size={18} color="#111" />
                    <Text style={styles.actionText}>Profile</Text>
                  </BlurView>
                </TouchableOpacity>
              </View>
              )}

              {/* Stranger: Add Friend + Block/Report */}
              {person.relationship === 'stranger' && (
                <>
                  <View style={styles.actionRow}>
                    <TouchableOpacity
                      style={styles.actionWrapper}
                      onPress={() => handleAddFriendPress(person.userId)}
                      disabled={!person.canSendFriendRequest || friendRequestSending || friendRequestSent}
                      activeOpacity={0.7}
                    >
                      <BlurView intensity={40} tint="light" style={[styles.blurButton, (!person.canSendFriendRequest || friendRequestSent) && styles.buttonDisabled]}>
                        {friendRequestSending ? (
                          <ActivityIndicator size="small" color="#111" />
                        ) : (
                          <Icon
                            name={friendRequestSent ? 'checkmark' : 'person-add-outline'}
                            size={18}
                            color={friendRequestSent ? '#16a34a' : (person.canSendFriendRequest ? '#111' : '#9ca3af')}
                          />
                        )}
                        <Text style={[styles.actionText, (!person.canSendFriendRequest || friendRequestSent) && styles.textDisabled]}>
                          {friendRequestSent ? 'Request Sent' : (person.canSendFriendRequest ? 'Add Friend' : 'Limit reached')}
                        </Text>
                      </BlurView>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.safetyRow}>
                    <TouchableOpacity onPress={() => onBlock(person.userId)} activeOpacity={0.7}>
                      <Text style={styles.safetyText}>Block</Text>
                    </TouchableOpacity>
                    <Text style={styles.safetyDot}>·</Text>
                    <TouchableOpacity onPress={() => onReport(person.userId)} activeOpacity={0.7}>
                      <Text style={styles.safetyText}>Report</Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </View>
          )}
        </BottomSheetScrollView>
      </BottomSheet>
    );
  }
);

PersonBottomSheet.displayName = 'PersonBottomSheet';

const styles = StyleSheet.create({
  handle: { backgroundColor: '#d1d5db', width: 36, height: 4, borderRadius: 2 },
  sheetBackground: { backgroundColor: '#FFF', borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  scrollContent: { paddingBottom: 24 },
  content: { padding: 20 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  avatar: { width: 56, height: 56, borderRadius: 28 },
  avatarFallback: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: '#e5e7eb', alignItems: 'center', justifyContent: 'center',
  },
  avatarInitials: { fontSize: 22, fontWeight: '700', color: '#6b7280' },
  headerText: { flex: 1 },
  name: { fontSize: 18, fontWeight: '700', color: '#111827' },
  relationship: { fontSize: 13, color: '#eb7825', fontWeight: '600', marginTop: 2 },
  status: { fontSize: 13, color: '#6b7280', marginTop: 4 },
  actionRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  actionWrapper: { flex: 1, minWidth: 70 },
  blurButton: {
    alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 12, borderRadius: 12,
    borderWidth: 1, borderColor: 'rgba(0,0,0,0.06)',
    overflow: 'hidden', backgroundColor: 'rgba(0,0,0,0.03)',
  },
  actionText: { fontSize: 11, fontWeight: '600', color: '#111827' },
  tasteMatchSection: { alignItems: 'center', paddingVertical: 12, gap: 4 },
  matchPctLarge: { fontSize: 28, fontWeight: '800', color: '#eb7825' },
  matchLabel: { fontSize: 11, color: '#6b7280', marginTop: -2 },
  sharedValues: { fontSize: 12, color: '#6b7280', textAlign: 'center', marginTop: 4 },
  buttonDisabled: { opacity: 0.4 },
  textDisabled: { color: '#9ca3af' },
  safetyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 },
  safetyText: { fontSize: 13, color: '#9ca3af' },
  safetyDot: { fontSize: 13, color: '#d1d5db' },
});
