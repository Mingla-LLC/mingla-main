import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BoardHeader } from './BoardHeader';
import { BoardTabs, BoardTab } from './BoardTabs';
import { Participant } from './ParticipantAvatars';
import { useBoardSession } from '../../hooks/useBoardSession';
import { supabase } from '../../services/supabase';
import { realtimeService } from '../../services/realtimeService';
import { useAppStore } from '../../store/appStore';
import SwipeableBoardCards from '../SwipeableBoardCards';
import BoardSettingsModal from './BoardSettingsModal';
import { BoardDiscussionTab } from './BoardDiscussionTab';
import { CardDiscussionModal } from './CardDiscussionModal';
import { BoardErrorHandler } from '../../services/boardErrorHandler';
import { useNetworkMonitor } from '../../services/networkMonitor';

interface BoardViewScreenProps {
  sessionId: string;
  onBack?: () => void;
  onNavigateToSession?: (sessionId: string) => void;
}

interface SavedCard {
  id: string;
  saved_card_id: string;
  session_id: string;
  saved_by: string;
  saved_at: string;
  experience_data?: any;
}

export const BoardViewScreen: React.FC<BoardViewScreenProps> = ({
  sessionId,
  onBack,
  onNavigateToSession,
}) => {
  const { session, preferences, loading: sessionLoading, error: sessionError } = useBoardSession(sessionId);
  const { user } = useAppStore();
  const networkState = useNetworkMonitor();
  const [activeTab, setActiveTab] = useState<BoardTab>('swipe');
  const [savedCards, setSavedCards] = useState<SavedCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [selectedCardForDiscussion, setSelectedCardForDiscussion] = useState<{
    savedCardId: string;
    cardTitle: string;
  } | null>(null);
  const [sessionValid, setSessionValid] = useState<boolean | null>(null);
  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Load saved cards for the session with pagination
  const [savedCardsPage, setSavedCardsPage] = useState(0);
  const [hasMoreCards, setHasMoreCards] = useState(true);
  const CARDS_PER_PAGE = 20;

  const loadSavedCards = useCallback(async (page: number = 0, append: boolean = false) => {
    if (!sessionId) return;

    // Check cache first
    const cacheKey = BoardCache.getSavedCardsKey(sessionId, page);
    const cached = await BoardCache.get<any[]>(cacheKey);
    if (cached && !append) {
      setSavedCards(cached);
      setLoadingCards(false);
      // Still fetch in background to update cache
    }

    setLoadingCards(true);
    try {
      const { data, error } = await supabase
        .from('board_saved_cards')
        .select('*')
        .eq('session_id', sessionId)
        .order('saved_at', { ascending: false })
        .range(page * CARDS_PER_PAGE, (page + 1) * CARDS_PER_PAGE - 1);

      if (error) {
        const boardError = BoardErrorHandler.handleNetworkError(error);
        BoardErrorHandler.showError(boardError, () => loadSavedCards(page, append));
        return;
      }

      // Cache the data
      await BoardCache.set(cacheKey, data || [], 2 * 60 * 1000); // 2 minutes

      if (append) {
        setSavedCards(prev => [...prev, ...(data || [])]);
      } else {
        setSavedCards(data || []);
      }

      setHasMoreCards((data || []).length === CARDS_PER_PAGE);
      setSavedCardsPage(page);
    } catch (err: any) {
      console.error('Error loading saved cards:', err);
      const boardError = BoardErrorHandler.handleNetworkError(err);
      BoardErrorHandler.showError(boardError);
    } finally {
      setLoadingCards(false);
    }
  }, [sessionId]);

  // Load participants
  const loadParticipants = useCallback(async () => {
    if (!sessionId) return;

    try {
      const { data, error } = await supabase
        .from('session_participants')
        .select(`
          *,
          profiles (
            id,
            username,
            display_name,
            first_name,
            last_name,
            avatar_url
          )
        `)
        .eq('session_id', sessionId);

      if (error) throw error;

      setParticipants((data || []) as Participant[]);
    } catch (err: any) {
      console.error('Error loading participants:', err);
    }
  }, [sessionId]);

  // Load unread message count
  const loadUnreadCount = useCallback(async () => {
    if (!sessionId || !user?.id) return;

    try {
      const { data, error } = await supabase.rpc('get_unread_message_count', {
        p_session_id: sessionId,
        p_user_id: user.id,
      });

      if (error) {
        // Function might not exist yet, set to 0
        console.warn('Error loading unread count:', error);
        setUnreadMessages(0);
        return;
      }

      setUnreadMessages(data || 0);
    } catch (err: any) {
      console.error('Error loading unread count:', err);
      setUnreadMessages(0);
    }
  }, [sessionId, user?.id]);

  // Handle card vote
  const handleVote = useCallback(async (cardId: string, vote: 'yes' | 'no') => {
    if (!user?.id || !sessionId) return;

    try {
      const savedCard = savedCards.find(c => c.saved_card_id === cardId);
      if (!savedCard) return;

      // Convert 'yes'/'no' to 'up'/'down' for database
      const voteType = vote === 'yes' ? 'up' : 'down';

      // Upsert vote
      const { error } = await supabase
        .from('board_votes')
        .upsert({
          session_id: sessionId,
          saved_card_id: savedCard.id,
          user_id: user.id,
          vote_type: voteType,
        }, {
          onConflict: 'board_votes_session_saved_card_user_unique',
        });

      if (error) throw error;

      // Broadcast vote update
      realtimeService.broadcastVoteUpdate(sessionId, savedCard.id, {
        user_id: user.id,
        vote_type: voteType,
      });

      // Reload vote counts
      loadVoteAndRSVPCounts();
    } catch (err: any) {
      console.error('Error voting:', err);
      Alert.alert('Error', 'Failed to submit vote');
    }
  }, [user?.id, sessionId, savedCards, loadVoteAndRSVPCounts]);

  // Handle RSVP
  const handleRSVP = useCallback(async (cardId: string, rsvp: 'yes' | 'no') => {
    if (!user?.id || !sessionId) return;

    // Check network
    if (!networkState.isConnected) {
      Alert.alert('No Connection', 'Please check your internet connection and try again.');
      return;
    }

    try {
      const savedCard = savedCards.find(c => c.saved_card_id === cardId);
      if (!savedCard) {
        Alert.alert('Error', 'Card not found');
        return;
      }

      // Convert 'yes'/'no' to 'attending'/'not_attending' for database
      const rsvpStatus = rsvp === 'yes' ? 'attending' : 'not_attending';

      // Upsert RSVP
      const { error } = await supabase
        .from('board_card_rsvps')
        .upsert({
          session_id: sessionId,
          saved_card_id: savedCard.id,
          user_id: user.id,
          rsvp_status: rsvpStatus,
        }, {
          onConflict: 'board_card_rsvps_session_saved_card_user_unique',
        });

      if (error) {
        const boardError = BoardErrorHandler.handleNetworkError(error);
        BoardErrorHandler.showError(boardError, () => handleRSVP(cardId, rsvp));
        return;
      }

      // Broadcast RSVP update
      realtimeService.broadcastRSVPUpdate(sessionId, savedCard.id, {
        user_id: user.id,
        rsvp_status: rsvpStatus,
      });

      // Reload RSVP counts
      loadVoteAndRSVPCounts();
      
      // Show success feedback
      toastManager.success(rsvp === 'yes' ? 'RSVP: Attending!' : 'RSVP: Not attending');
    } catch (err: any) {
      console.error('Error RSVPing:', err);
      const boardError = BoardErrorHandler.handleNetworkError(err);
      BoardErrorHandler.showError(boardError);
    }
  }, [user?.id, sessionId, savedCards, loadVoteAndRSVPCounts, networkState.isConnected]);

  // Load card message counts
  const [cardMessageCounts, setCardMessageCounts] = useState<Record<string, number>>({});

  const loadCardMessageCounts = useCallback(async () => {
    if (!sessionId || !user?.id || savedCards.length === 0) return;

    try {
      const savedCardIds = savedCards.map(c => c.id);
      const { data, error } = await supabase
        .from('board_card_messages')
        .select('saved_card_id')
        .eq('session_id', sessionId)
        .in('saved_card_id', savedCardIds)
        .is('deleted_at', null);

      if (error) throw error;

      // Count messages per card
      const counts: Record<string, number> = {};
      savedCardIds.forEach(cardId => {
        counts[cardId] = (data || []).filter(m => m.saved_card_id === cardId).length;
      });

      setCardMessageCounts(counts);
    } catch (err: any) {
      console.error('Error loading card message counts:', err);
    }
  }, [sessionId, user?.id, savedCards]);

  // Subscribe to real-time updates
  useEffect(() => {
    if (!sessionId) return;

    const channel = realtimeService.subscribeToBoardSession(sessionId, {
      onCardSaved: (card) => {
        setSavedCards(prev => {
          if (prev.find(c => c.id === card.id)) return prev;
          return [card, ...prev];
        });
        loadCardMessageCounts();
      },
      onCardVoted: () => {
        loadVoteAndRSVPCounts();
      },
      onCardRSVP: () => {
        loadVoteAndRSVPCounts();
      },
      onMessage: () => {
        loadUnreadCount();
        loadCardMessageCounts();
      },
      onCardMessage: () => {
        loadCardMessageCounts();
      },
      onParticipantJoined: () => {
        loadParticipants();
      },
      onParticipantLeft: () => {
        loadParticipants();
      },
    });

    return () => {
      realtimeService.unsubscribe(`board_session:${sessionId}`);
    };
  }, [sessionId, loadSavedCards, loadUnreadCount, loadParticipants, loadCardMessageCounts, loadVoteAndRSVPCounts]);

  // Validate session and permissions on mount
  useEffect(() => {
    const validateSession = async () => {
      if (!sessionId || !user?.id) return;

      // Check session validity
      const validityCheck = await BoardErrorHandler.checkSessionValidity(sessionId);
      setSessionValid(validityCheck.valid);

      if (!validityCheck.valid && validityCheck.error) {
        BoardErrorHandler.showError(validityCheck.error, () => {
          if (onBack) onBack();
        });
        return;
      }

      // Check permissions
      const permissionCheck = await BoardErrorHandler.checkSessionPermission(sessionId, user.id);
      setHasPermission(permissionCheck.hasPermission);
      setIsAdmin(permissionCheck.isAdmin || false);

      if (!permissionCheck.hasPermission && permissionCheck.error) {
        BoardErrorHandler.showError(permissionCheck.error, () => {
          if (onBack) onBack();
        });
        return;
      }
    };

    validateSession();
  }, [sessionId, user?.id, onBack]);

  // Load data on mount
  useEffect(() => {
    if (sessionValid && hasPermission) {
      loadSavedCards(0, false);
      loadParticipants();
      loadUnreadCount();
    }
  }, [sessionValid, hasPermission, loadSavedCards, loadParticipants, loadUnreadCount]);

  // Load vote and RSVP counts for saved cards
  const [voteCounts, setVoteCounts] = useState<Record<string, { yes: number; no: number; userVote: 'yes' | 'no' | null }>>({});
  const [rsvpCounts, setRsvpCounts] = useState<Record<string, { responded: number; total: number; userRSVP: 'yes' | 'no' | null }>>({});

  const loadVoteAndRSVPCounts = useCallback(async () => {
    if (!sessionId || !user?.id || savedCards.length === 0) return;

    try {
      // Load vote counts for all saved cards
      const savedCardIds = savedCards.map(c => c.id);
      const { data: votesData, error: votesError } = await supabase
        .from('board_votes')
        .select('*')
        .eq('session_id', sessionId)
        .in('saved_card_id', savedCardIds);

      if (votesError) throw votesError;

      // Aggregate vote counts (convert 'up'/'down' to 'yes'/'no')
      const counts: Record<string, { yes: number; no: number; userVote: 'yes' | 'no' | null }> = {};
      savedCards.forEach(card => {
        const cardVotes = votesData?.filter(v => v.saved_card_id === card.id) || [];
        const yesVotes = cardVotes.filter(v => v.vote_type === 'up').length;
        const noVotes = cardVotes.filter(v => v.vote_type === 'down').length;
        const userVoteRaw = cardVotes.find(v => v.user_id === user.id)?.vote_type;
        const userVote = userVoteRaw === 'up' ? 'yes' : userVoteRaw === 'down' ? 'no' : null;
        
        counts[card.id] = {
          yes: yesVotes,
          no: noVotes,
          userVote,
        };
      });
      setVoteCounts(counts);

      // Load RSVP counts
      const { data: rsvpsData, error: rsvpsError } = await supabase
        .from('board_card_rsvps')
        .select('*')
        .eq('session_id', sessionId)
        .in('saved_card_id', savedCardIds);

      if (rsvpsError) throw rsvpsError;

      // Aggregate RSVP counts (convert 'attending'/'not_attending' to 'yes'/'no')
      const rsvpCountsData: Record<string, { responded: number; total: number; userRSVP: 'yes' | 'no' | null }> = {};
      const totalParticipants = participants.filter(p => p.has_accepted).length;
      savedCards.forEach(card => {
        const cardRSVPs = rsvpsData?.filter(r => r.saved_card_id === card.id) || [];
        const yesRSVPs = cardRSVPs.filter(r => r.rsvp_status === 'attending').length;
        const noRSVPs = cardRSVPs.filter(r => r.rsvp_status === 'not_attending').length;
        const userRSVPRaw = cardRSVPs.find(r => r.user_id === user.id)?.rsvp_status;
        const userRSVP = userRSVPRaw === 'attending' ? 'yes' : userRSVPRaw === 'not_attending' ? 'no' : null;
        
        rsvpCountsData[card.id] = {
          responded: yesRSVPs + noRSVPs,
          total: totalParticipants,
          userRSVP,
        };
      });
      setRsvpCounts(rsvpCountsData);
    } catch (err: any) {
      console.error('Error loading vote/RSVP counts:', err);
    }
  }, [sessionId, user?.id, savedCards, participants]);

  useEffect(() => {
    if (savedCards.length > 0) {
      loadVoteAndRSVPCounts();
      loadCardMessageCounts();
    }
  }, [savedCards, loadVoteAndRSVPCounts, loadCardMessageCounts]);

  // Transform saved cards to board card format
  const boardCards = savedCards.map(savedCard => {
    const experience = savedCard.experience_data || {};
    const voteData = voteCounts[savedCard.id] || { yes: 0, no: 0, userVote: null };
    const rsvpData = rsvpCounts[savedCard.id] || { responded: 0, total: participants.filter(p => p.has_accepted).length, userRSVP: null };
    const messageCount = cardMessageCounts[savedCard.id] || 0;
    
    return {
      id: savedCard.saved_card_id,
      title: experience.title || 'Untitled Experience',
      category: experience.category || 'Experience',
      categoryIcon: experience.categoryIcon || 'star',
      image: experience.image || '',
      images: experience.images || [],
      rating: experience.rating || 0,
      reviewCount: experience.reviewCount || 0,
      travelTime: experience.travelTime || 'N/A',
      priceRange: experience.priceRange || 'N/A',
      description: experience.description || '',
      fullDescription: experience.fullDescription || '',
      address: experience.address || '',
      highlights: experience.highlights || [],
      matchScore: experience.matchScore || 0,
      socialStats: experience.socialStats || { views: 0, likes: 0, saves: 0 },
      votes: voteData,
      rsvps: rsvpData,
      messages: messageCount,
      isLocked: false,
    };
  });

  // Show network error banner
  const showNetworkBanner = !networkState.isConnected;

  if (sessionLoading || sessionValid === null || hasPermission === null) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#007AFF" />
          <Text style={styles.loadingText}>Loading board session...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (sessionError || !session || !sessionValid || !hasPermission) {
    const error = sessionError
      ? BoardErrorHandler.handleSessionError({ message: sessionError })
      : !sessionValid
      ? { userFriendlyMessage: 'This board session is no longer available.' }
      : !hasPermission
      ? { userFriendlyMessage: 'You don\'t have permission to access this session.' }
      : { userFriendlyMessage: 'Session not found' };

    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Ionicons name="alert-circle" size={48} color="#FF3B30" />
          <Text style={styles.errorText}>
            {error.userFriendlyMessage || 'Session not found'}
          </Text>
          {onBack && (
            <TouchableOpacity
              style={styles.backButton}
              onPress={onBack}
            >
              <Text style={styles.backButtonText}>Go Back</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Network Error Banner */}
      {showNetworkBanner && (
        <View style={styles.networkBanner}>
          <Ionicons name="wifi-outline" size={16} color="white" />
          <Text style={styles.networkBannerText}>
            No internet connection. Some features may be unavailable.
          </Text>
        </View>
      )}

      <BoardHeader
        session={session}
        participants={participants}
        onSettingsPress={() => {
          if (isAdmin || session.created_by === user?.id) {
            setShowSettings(true);
          } else {
            Alert.alert('Permission Denied', 'Only session admins can access settings.');
          }
        }}
        onInvitePress={() => {
          // Open invite modal
          Alert.alert('Invite', 'Invite functionality coming soon');
        }}
        loading={loadingCards}
      />

      <BoardTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        savedCount={savedCards.length}
        unreadMessages={unreadMessages}
      />

      <View style={styles.content}>
        {activeTab === 'swipe' && (
          <SwipeableBoardCards
            cards={boardCards}
            onVote={handleVote}
            onRSVP={handleRSVP}
            onOpenDiscussion={(cardId: string) => {
              const card = boardCards.find(c => c.id === cardId);
              if (card) {
                const savedCard = savedCards.find(sc => sc.saved_card_id === cardId);
                if (savedCard) {
                  setSelectedCardForDiscussion({
                    savedCardId: savedCard.id,
                    cardTitle: card.title,
                  });
                }
              }
            }}
          />
        )}

        {activeTab === 'saved' && (
          <ScrollView
            style={styles.savedContainer}
            onScrollEndDrag={(e) => {
              const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
              const isCloseToBottom = contentOffset.y + layoutMeasurement.height >= contentSize.height - 200;
              if (isCloseToBottom && hasMoreCards && !loadingCards) {
                loadSavedCards(savedCardsPage + 1, true);
              }
            }}
            scrollEventThrottle={400}
          >
            {loadingCards && savedCards.length === 0 ? (
              <View style={styles.savedContainer}>
                <CardSkeleton count={3} />
              </View>
            ) : savedCards.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Ionicons name="images-outline" size={64} color="#ccc" />
                <Text style={styles.emptyText}>No saved cards yet</Text>
                <Text style={styles.emptySubtext}>
                  Swipe right on cards to save them to this board
                </Text>
              </View>
            ) : (
              <>
                {savedCards.map(card => (
                  <View key={card.id} style={styles.savedCard}>
                    <Text style={styles.savedCardTitle}>
                      {card.experience_data?.title || 'Untitled'}
                    </Text>
                    <Text style={styles.savedCardDescription}>
                      {card.experience_data?.description || ''}
                    </Text>
                  </View>
                ))}
                {loadingCards && savedCards.length > 0 && (
                  <View style={styles.loadingMoreContainer}>
                    <ActivityIndicator size="small" color="#007AFF" />
                    <Text style={styles.loadingMoreText}>Loading more cards...</Text>
                  </View>
                )}
              </>
            )}
          </ScrollView>
        )}

        {activeTab === 'discussion' && (
          <BoardDiscussionTab
            sessionId={sessionId}
            participants={participants}
          />
        )}
      </View>

      {showSettings && (
        <BoardSettingsModal
          sessionId={sessionId}
          onClose={() => setShowSettings(false)}
        />
      )}

      {selectedCardForDiscussion && (
        <CardDiscussionModal
          visible={!!selectedCardForDiscussion}
          sessionId={sessionId}
          savedCardId={selectedCardForDiscussion.savedCardId}
          cardTitle={selectedCardForDiscussion.cardTitle}
          participants={participants}
          onClose={() => setSelectedCardForDiscussion(null)}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    gap: 16,
  },
  errorText: {
    fontSize: 16,
    color: '#FF3B30',
    textAlign: 'center',
    fontWeight: '500',
  },
  backButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: 'white',
    fontWeight: '600',
  },
  networkBanner: {
    backgroundColor: '#FF9500',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
    gap: 8,
  },
  networkBannerText: {
    color: 'white',
    fontSize: 13,
    fontWeight: '500',
  },
  content: {
    flex: 1,
  },
  savedContainer: {
    flex: 1,
    padding: 16,
  },
  savedCard: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  savedCardTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  savedCardDescription: {
    fontSize: 14,
    color: '#666',
  },
  discussionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  comingSoonText: {
    fontSize: 16,
    color: '#666',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1a1a1a',
    marginBottom: 8,
  },
  emptySubtext: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  loadingMoreContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
    gap: 8,
  },
  loadingMoreText: {
    fontSize: 14,
    color: '#666',
  },
});

