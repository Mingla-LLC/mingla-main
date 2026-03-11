import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { TrackedTouchableOpacity } from './TrackedTouchableOpacity';
import { Ionicons } from '@expo/vector-icons';
import { spacing, radius, colors, typography, fontWeights, commonStyles } from '../constants/designSystem';

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  retryText?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  type?: 'error' | 'warning' | 'info';
}

export const ErrorState: React.FC<ErrorStateProps> = ({
  title = 'Something went wrong',
  message = 'We encountered an error while loading your recommendations. Please try again.',
  onRetry,
  retryText = 'Try Again',
  icon = 'alert-circle',
  type = 'error',
}) => {
  const getIconColor = () => {
    switch (type) {
      case 'error':
        return colors.error[500];
      case 'warning':
        return colors.warning[500];
      case 'info':
        return colors.primary[500];
      default:
        return colors.error[500];
    }
  };

  const getBackgroundColor = () => {
    switch (type) {
      case 'error':
        return colors.error[50];
      case 'warning':
        return colors.warning[50];
      case 'info':
        return colors.primary[50];
      default:
        return colors.error[50];
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: getBackgroundColor() }]}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Ionicons
            name={icon}
            size={48}
            color={getIconColor()}
          />
        </View>
        
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        
        {onRetry && (
          <TrackedTouchableOpacity logComponent="ErrorState"
            style={[styles.retryButton, { borderColor: getIconColor() }]}
            onPress={onRetry}
            activeOpacity={0.8}
          >
            <Ionicons
              name="refresh"
              size={20}
              color={getIconColor()}
              style={styles.retryIcon}
            />
            <Text style={[styles.retryText, { color: getIconColor() }]}>
              {retryText}
            </Text>
          </TrackedTouchableOpacity>
        )}
      </View>
    </View>
  );
};

// Specific error states for common scenarios
export const NetworkErrorState: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => (
  <ErrorState
    title="No Internet Connection"
    message="Please check your internet connection and try again."
    onRetry={onRetry}
    retryText="Retry"
    icon="wifi"
    type="error"
  />
);

export const RecommendationsErrorState: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => (
  <ErrorState
    title="Unable to Load Recommendations"
    message="We couldn't find any recommendations for you right now. Please check your preferences and try again."
    onRetry={onRetry}
    retryText="Refresh Recommendations"
    icon="search"
    type="info"
  />
);

export const AuthErrorState: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => (
  <ErrorState
    title="Authentication Error"
    message="There was a problem with your account. Please sign in again."
    onRetry={onRetry}
    retryText="Sign In Again"
    icon="person-circle-outline"
    type="warning"
  />
);

// Empty state component
interface EmptyStateProps {
  title: string;
  message: string;
  icon?: keyof typeof Ionicons.glyphMap;
  actionText?: string;
  onAction?: () => void;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  message,
  icon = 'infinite',
  actionText,
  onAction,
}) => {
  return (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyContent}>
        <View style={styles.emptyIconContainer}>
          <Ionicons
            name={icon}
            size={64}
            color={colors.gray[400]}
          />
        </View>
        
        <Text style={styles.emptyTitle}>{title}</Text>
        <Text style={styles.emptyMessage}>{message}</Text>
        
        {actionText && onAction && (
          <TrackedTouchableOpacity logComponent="ErrorState"
            style={styles.emptyActionButton}
            onPress={onAction}
            activeOpacity={0.8}
          >
            <Text style={styles.emptyActionText}>{actionText}</Text>
          </TrackedTouchableOpacity>
        )}
      </View>
    </View>
  );
};

// Specific empty states
export const NoRecommendationsState: React.FC<{ onRefresh?: () => void }> = ({ onRefresh }) => (
  <EmptyState
    title="No Recommendations Found"
    message="We couldn't find any experiences that match your current preferences. Try adjusting your filters or location."
    icon="compass-outline"
    actionText="Adjust Preferences"
    onAction={onRefresh}
  />
);

export const NoSavedExperiencesState: React.FC<{ onExplore?: () => void }> = ({ onExplore }) => (
  <EmptyState
    title="No Saved Experiences"
    message="Start exploring and save experiences you love to see them here."
    icon="heart-outline"
    actionText="Start Exploring"
    onAction={onExplore}
  />
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    borderRadius: radius.lg,
    margin: spacing.lg,
  },
  content: {
    alignItems: 'center',
    maxWidth: 300,
  },
  iconContainer: {
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.xl,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  message: {
    ...typography.md,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.lg,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    backgroundColor: colors.background.primary,
  },
  retryIcon: {
    marginRight: spacing.sm,
  },
  retryText: {
    ...typography.md,
    fontWeight: fontWeights.medium,
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyContent: {
    alignItems: 'center',
    maxWidth: 300,
  },
  emptyIconContainer: {
    marginBottom: spacing.lg,
  },
  emptyTitle: {
    ...typography.xl,
    fontWeight: fontWeights.semibold,
    color: colors.text.primary,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  emptyMessage: {
    ...typography.md,
    fontWeight: fontWeights.regular,
    color: colors.text.secondary,
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: spacing.lg,
  },
  emptyActionButton: {
    backgroundColor: colors.primary[500],
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
  },
  emptyActionText: {
    ...typography.md,
    fontWeight: fontWeights.medium,
    color: colors.text.inverse,
  },
});
