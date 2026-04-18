import React from 'react';
import {
  View,
  Text,
  Switch,
  StyleSheet,
  LayoutAnimation,
  Platform,
  UIManager,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { colors, spacing } from '../../constants/designSystem';

// Enable LayoutAnimation on Android
if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

interface ToggleSectionProps {
  title: string;
  subtitle?: string;
  isOn: boolean;
  onToggle: (newValue: boolean) => void;
  disabled?: boolean;
  warning?: string | null;
  children: React.ReactNode;
}

export const ToggleSection: React.FC<ToggleSectionProps> = ({
  title,
  isOn,
  onToggle,
  disabled,
  warning,
  children,
}) => {
  const handleToggle = (newValue: boolean): void => {
    if (!newValue && disabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      return;
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onToggle(newValue);
  };

  return (
    <View style={toggleStyles.glassCard}>
      <View style={toggleStyles.headerRow}>
        <Text style={toggleStyles.question}>{title}</Text>
        <Switch
          value={isOn}
          onValueChange={handleToggle}
          trackColor={{ false: colors.gray[300], true: colors.accent }}
          thumbColor="#ffffff"
          ios_backgroundColor={colors.gray[300]}
          accessibilityLabel={`${title} toggle`}
          accessibilityRole="switch"
        />
      </View>
      {isOn && (
        <View style={toggleStyles.content}>
          {children}
        </View>
      )}
      {warning && (
        <View style={toggleStyles.warningPill}>
          <Text style={toggleStyles.warningText}>{warning}</Text>
        </View>
      )}
    </View>
  );
};

const toggleStyles = StyleSheet.create({
  glassCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.70)',
    borderWidth: 1,
    borderTopWidth: 0.5,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    borderRadius: 24,
    padding: 20,
    marginHorizontal: 16,
    marginTop: 16,
    shadowColor: 'rgba(0, 0, 0, 0.08)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 1,
    shadowRadius: 24,
    elevation: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  question: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6b7280',
    flex: 1,
    marginRight: spacing.md,
  },
  content: {
    marginTop: 20,
  },
  warningPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginTop: 10,
  },
  warningText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#ea580c',
  },
});
