import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import { Icon } from '../ui/Icon';
import Toggle from './Toggle';

interface SettingsRowProps {
  label: string;
  hint?: string;
  // Toggle rows
  toggle?: boolean;
  toggleValue?: boolean;
  onToggle?: () => void;
  // Value-cycling rows
  value?: string;
  // Navigation rows
  icon?: string;
  description?: string;
  showChevron?: boolean;
  // Shared
  onPress?: () => void;
  isLast?: boolean;
}

export const SettingsRow: React.FC<SettingsRowProps> = ({
  label,
  hint,
  toggle,
  toggleValue,
  onToggle,
  value,
  icon,
  description,
  showChevron,
  onPress,
  isLast,
}) => {
  const isInteractive = !!(onPress || onToggle);

  const content = (
    <View style={[styles.row, !isLast && styles.rowBorder]}>
      {icon && (
        <View style={styles.iconContainer}>
          <Icon name={icon} size={20} color="#6b7280" />
        </View>
      )}
      <View style={styles.labelContainer}>
        <Text style={[styles.label, icon && styles.labelBold]}>{label}</Text>
        {hint && <Text style={styles.hint}>{hint}</Text>}
        {description && <Text style={styles.description}>{description}</Text>}
      </View>
      {toggle && onToggle && (
        <Toggle value={!!toggleValue} onToggle={onToggle} />
      )}
      {value != null && (
        <View style={styles.valueRow}>
          <Text style={styles.value}>{value}</Text>
          <Icon name="chevron-forward" size={16} color="#9ca3af" />
        </View>
      )}
      {showChevron && !value && (
        <Icon name="chevron-forward" size={16} color="#9ca3af" />
      )}
    </View>
  );

  if (isInteractive && !toggle) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
        {content}
      </TouchableOpacity>
    );
  }

  return content;
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  rowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  iconContainer: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#f3f4f6',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  labelContainer: {
    flex: 1,
  },
  label: {
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
  },
  labelBold: {
    fontWeight: '600',
  },
  hint: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
  description: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 2,
  },
  valueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  value: {
    fontSize: 14,
    color: '#eb7825',
    fontWeight: '700',
  },
});

export default SettingsRow;
