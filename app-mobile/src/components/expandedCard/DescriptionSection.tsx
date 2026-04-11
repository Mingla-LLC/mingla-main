import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, NativeSyntheticEvent, TextLayoutEventData } from 'react-native';
import { useTranslation } from 'react-i18next';

const COLLAPSED_LINES = 4;

interface DescriptionSectionProps {
  title: string;
  description: string;
  fullDescription?: string;
}

export default function DescriptionSection({
  title,
  description,
  fullDescription,
}: DescriptionSectionProps) {
  const { t } = useTranslation(['expanded_details', 'common']);
  const displayDescription = fullDescription || description;
  const [isExpanded, setIsExpanded] = useState(false);
  const [isTruncated, setIsTruncated] = useState(false);

  const handleTextLayout = useCallback(
    (e: NativeSyntheticEvent<TextLayoutEventData>) => {
      // onTextLayout fires with the FULL text layout (before numberOfLines clips).
      // If more lines exist than COLLAPSED_LINES, the text will be truncated.
      if (!isExpanded && e.nativeEvent.lines.length > COLLAPSED_LINES) {
        setIsTruncated(true);
      }
    },
    [isExpanded],
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text
        style={styles.description}
        numberOfLines={isExpanded ? undefined : COLLAPSED_LINES}
        onTextLayout={handleTextLayout}
      >
        {displayDescription}
      </Text>
      {isTruncated && (
        <TouchableOpacity
          onPress={() => setIsExpanded(prev => !prev)}
          activeOpacity={0.7}
          style={styles.toggleButton}
        >
          <Text style={styles.toggleText}>
            {isExpanded ? t('expanded_details:description.show_less') : t('expanded_details:description.read_more')}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 20,
    backgroundColor: '#ffffff',
  },
  title: {
    fontSize: 20,
    fontWeight: '600',
    color: '#111827',
    marginBottom: 12,
  },
  description: {
    fontSize: 15,
    color: '#374151',
    lineHeight: 24,
  },
  toggleButton: {
    marginTop: 8,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#eb7825',
  },
});
