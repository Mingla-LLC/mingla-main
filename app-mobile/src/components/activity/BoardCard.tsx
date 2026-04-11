import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { TrackedTouchableOpacity } from '../TrackedTouchableOpacity';
import { Icon } from '../ui/Icon';
import { useTranslation } from 'react-i18next';

interface Board {
  id: string;
  name: string;
  type: 'date-night' | 'group-hangout' | 'adventure' | 'wellness' | 'food-tour' | 'cultural';
  description: string;
  participants: Array<{
    id: string;
    name: string;
    status: string;
    lastActive?: string;
  }>;
  status: 'active' | 'voting' | 'locked' | 'completed';
  voteDeadline?: string;
  finalizedDate?: string;
  cardsCount: number;
  createdAt: string;
  unreadMessages: number;
  lastActivity: string;
  icon: any;
  gradient: string;
  creatorId: string | null;
  admins: string[];
  currentUserId: string;
}

interface BoardCardProps {
  board: Board;
  onOpenBoard: (boardId: string) => void;
  onInviteToSession: (boardId: string, boardName: string) => void;
  onToggleNotifications: (boardId: string) => void;
  onExitBoard: (boardId: string, boardName: string) => void;
  onLeaveBoard: (boardId: string, boardName: string) => void;
  isNotificationEnabled: boolean;
  isUserAdmin: boolean;
  showMenu?: boolean;
}

const BoardCard = ({
  board,
  onOpenBoard,
  onInviteToSession,
  onToggleNotifications,
  onExitBoard,
  onLeaveBoard,
  isNotificationEnabled,
  isUserAdmin,
  showMenu = true
}: BoardCardProps) => {
  const { t } = useTranslation(['activity', 'common']);
  const styles = StyleSheet.create({
    card: {
      backgroundColor: 'white',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: '#e5e7eb',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.1,
      shadowRadius: 2,
      elevation: 1,
    },
    cardContent: {
      padding: 16,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    cardInfo: {
      flex: 1,
    },
    cardName: {
      fontSize: 16,
      fontWeight: '600',
      color: '#111827',
      marginBottom: 4,
    },
    cardDescription: {
      fontSize: 14,
      color: '#6b7280',
      lineHeight: 20,
    },
    statusBadge: {
      flexShrink: 0,
      marginLeft: 12,
    },
    votingBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: 'rgba(235, 120, 37, 0.1)',
      borderRadius: 20,
    },
    votingBadgeText: {
      fontSize: 12,
      color: '#eb7825',
    },
    lockedBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: '#f3f4f6',
      borderRadius: 20,
    },
    lockedBadgeText: {
      fontSize: 12,
      color: '#374151',
    },
    activeBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: '#dcfce7',
      borderRadius: 20,
    },
    activeBadgeText: {
      fontSize: 12,
      color: '#166534',
    },
    completedBadge: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      backgroundColor: '#dbeafe',
      borderRadius: 20,
    },
    completedBadgeText: {
      fontSize: 12,
      color: '#1e40af',
    },
    statsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 16,
    },
    statsContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 16,
    },
    statItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    statNumber: {
      fontSize: 14,
      color: '#111827',
    },
    statLabel: {
      fontSize: 12,
      color: '#6b7280',
      letterSpacing: 0.5,
    },
    statDivider: {
      width: 4,
      height: 4,
      backgroundColor: '#d1d5db',
      borderRadius: 2,
    },
    actionsContainer: {
      flexDirection: 'row',
      gap: 8,
    },
    primaryButton: {
      flex: 1,
      backgroundColor: '#eb7825',
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: 'center',
    },
    primaryButtonText: {
      color: 'white',
      fontSize: 14,
      fontWeight: '500',
    },
    secondaryButton: {
      width: 40,
      height: 40,
      borderWidth: 1,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
    },
    adminButton: {
      borderColor: '#eb7825',
    },
    menuButton: {
      borderColor: '#e5e7eb',
    },
    leaveButton: {
      borderColor: '#fecaca',
    },
    buttonIcon: {
      width: 16,
      height: 16,
    },
    adminIcon: {
      color: '#eb7825',
    },
    menuIcon: {
      color: '#6b7280',
    },
    leaveIcon: {
      color: '#ef4444',
    },
  });

  const getIconComponent = (iconName: any) => {
    if (typeof iconName === 'function') {
      return iconName;
    }
    
    const iconMap: {[key: string]: string} = {
      'Coffee': 'cafe',
      'TreePine': 'leaf',
      'Sparkles': 'sparkles',
      'Dumbbell': 'fitness',
      'Utensils': 'restaurant',
      'Eye': 'eye',
      'Heart': 'heart',
      'Calendar': 'calendar',
      'MapPin': 'location',
      'Clock': 'time',
      'Star': 'star',
      'Navigation': 'navigate',
      'Users': 'people',
      'Check': 'checkmark',
      'ThumbsUp': 'thumbs-up',
      'ThumbsDown': 'thumbs-down',
      'MessageSquare': 'chatbubble',
      'Share2': 'share',
      'X': 'close',
      'ChevronRight': 'chevron-forward',
      'ChevronLeft': 'chevron-back',
      'Bookmark': 'bookmark'
    };
    
    return iconMap[iconName] || 'heart';
  };

  const renderStatusBadge = () => {
    switch (board.status) {
      case 'voting':
        return (
          <View style={styles.votingBadge}>
            <Text style={styles.votingBadgeText}>{t('activity:boardCard.voting')}</Text>
          </View>
        );
      case 'locked':
        return (
          <View style={styles.lockedBadge}>
            <Text style={styles.lockedBadgeText}>{t('activity:boardCard.lockedIn')}</Text>
          </View>
        );
      case 'active':
        return (
          <View style={styles.activeBadge}>
            <Text style={styles.activeBadgeText}>{t('activity:boardCard.active')}</Text>
          </View>
        );
      case 'completed':
        return (
          <View style={styles.completedBadge}>
            <Text style={styles.completedBadgeText}>{t('activity:boardCard.completed')}</Text>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.cardContent}>
        {/* Header Section */}
        <View style={styles.cardHeader}>
          <View style={styles.cardInfo}>
            <Text style={styles.cardName}>{board.name}</Text>
            <Text style={styles.cardDescription}>{board.description}</Text>
          </View>
          
          {/* Status Badge */}
          <View style={styles.statusBadge}>
            {renderStatusBadge()}
          </View>
        </View>
        
        {/* Stats Row */}
        <View style={styles.statsRow}>
          <View style={styles.statsContainer}>
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{board.participants.length}</Text>
              <Text style={styles.statLabel}>{t('activity:boardCard.members')}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statNumber}>{board.cardsCount}</Text>
              <Text style={styles.statLabel}>{t('activity:boardCard.experiences')}</Text>
            </View>
          </View>
        </View>
        
        {/* Actions Section */}
        <View style={styles.actionsContainer}>
          {/* Primary Action */}
          <TrackedTouchableOpacity logComponent="BoardCard" 
            onPress={() => onOpenBoard(board.id)}
            style={styles.primaryButton}
          >
            <Text style={styles.primaryButtonText}>{t('activity:boardCard.openBoard')}</Text>
          </TrackedTouchableOpacity>
          
          {/* Admin Actions */}
          {isUserAdmin && (
            <TrackedTouchableOpacity logComponent="BoardCard" 
              onPress={() => onInviteToSession(board.id, board.name)}
              style={[styles.secondaryButton, styles.adminButton]}
            >
              <Icon name="person-add" size={16} color="#eb7825" />
            </TrackedTouchableOpacity>
          )}
          
          {/* Board Menu */}
          {showMenu && (
            <TrackedTouchableOpacity logComponent="BoardCard"
              onPress={() => onToggleNotifications(board.id)}
              style={[styles.secondaryButton, styles.menuButton]}
            >
              <Icon 
                name={isNotificationEnabled ? "notifications" : "notifications-off"} 
                size={16} 
                color="#6b7280" 
              />
            </TrackedTouchableOpacity>
          )}
          
          {/* Leave Board */}
          {!isUserAdmin && (
            <TrackedTouchableOpacity logComponent="BoardCard" 
              onPress={() => onLeaveBoard(board.id, board.name)}
              style={[styles.secondaryButton, styles.leaveButton]}
            >
              <Icon name="log-out" size={16} color="#ef4444" />
            </TrackedTouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
};

export default BoardCard;
