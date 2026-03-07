import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  StyleSheet,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFriendProfile } from '../../hooks/useFriendProfile';
import ProfileHeroSection from './ProfileHeroSection';
import ProfilePhotosGallery from './ProfilePhotosGallery';
import ProfileInterestsSection from './ProfileInterestsSection';
import ProfileStatsRow from './ProfileStatsRow';

interface ViewFriendProfileScreenProps {
  userId: string;
  onBack: () => void;
  onMessage?: (userId: string) => void;
}

const ViewFriendProfileScreen: React.FC<ViewFriendProfileScreenProps> = ({
  userId,
  onBack,
  onMessage,
}) => {
  const { data: profile, isLoading, isError } = useFriendProfile(userId);

  const handleRemoveFriend = () => {
    if (!profile) return;
    Alert.alert(
      'Remove Friend',
      `Are you sure you want to remove ${profile.first_name || 'this person'} as a friend?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => {
          Alert.alert('Coming Soon', 'Friend removal from profile will be available in a future update.');
        } },
      ],
    );
  };

  const renderHeader = () => (
    <View style={styles.header}>
      <TouchableOpacity onPress={onBack} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
        <Ionicons name="arrow-back" size={24} color="#111827" />
      </TouchableOpacity>
      <Text style={styles.headerTitle}>Profile</Text>
      <View style={styles.headerSpacer} />
    </View>
  );

  if (isLoading) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#eb7825" />
        </View>
      </View>
    );
  }

  if (isError || !profile) {
    return (
      <View style={styles.container}>
        {renderHeader()}
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>This profile isn't available</Text>
          <Text style={styles.errorBody}>
            This person's profile may be private, or you may not be connected.
          </Text>
          <TouchableOpacity style={styles.goBackButton} onPress={onBack} activeOpacity={0.8}>
            <Text style={styles.goBackText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const hasPhotos = profile.photos.length > 0;
  const hasInterests = profile.intents.length > 0 || profile.categories.length > 0;

  return (
    <View style={styles.container}>
      {renderHeader()}
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        <ProfileHeroSection
          isOwnProfile={false}
          firstName={profile.first_name}
          lastName={profile.last_name}
          username={profile.username}
          avatarUrl={profile.avatar_url}
          bio={profile.bio}
        />

        {hasPhotos && (
          <ProfilePhotosGallery
            photos={profile.photos}
            isOwnProfile={false}
          />
        )}

        {hasInterests && (
          <ProfileInterestsSection
            intents={profile.intents}
            categories={profile.categories}
            isOwnProfile={false}
          />
        )}

        <ProfileStatsRow
          savedCount={profile.savedCount}
          connectionsCount={profile.connectionsCount}
          boardsCount={profile.boardsCount}
        />

        {onMessage && (
          <TouchableOpacity
            style={styles.messageButton}
            onPress={() => onMessage(userId)}
            activeOpacity={0.8}
          >
            <Text style={styles.messageText}>Message</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity onPress={handleRemoveFriend} style={styles.removeWrap}>
          <Text style={styles.removeText}>Remove Friend</Text>
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#ffffff' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 48,
    paddingHorizontal: 24,
    paddingBottom: 12,
    backgroundColor: '#ffffff',
  },
  headerTitle: { flex: 1, fontSize: 18, fontWeight: '700', color: '#111827', textAlign: 'center' },
  headerSpacer: { width: 24 },
  scroll: { flex: 1 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#111827', textAlign: 'center' },
  errorBody: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20,
  },
  goBackButton: {
    backgroundColor: '#eb7825',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 40,
    marginTop: 24,
  },
  goBackText: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
  messageButton: {
    backgroundColor: '#eb7825',
    borderRadius: 12,
    paddingVertical: 16,
    marginHorizontal: 24,
    alignItems: 'center',
    marginTop: 8,
  },
  messageText: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
  removeWrap: { alignItems: 'center', marginTop: 16 },
  removeText: { fontSize: 15, color: '#ef4444', fontWeight: '600' },
  bottomPadding: { height: 48 },
});

export default ViewFriendProfileScreen;
