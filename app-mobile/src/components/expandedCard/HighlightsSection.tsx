import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface HighlightsSectionProps {
  highlights: string[];
  category?: string;
}

export default function HighlightsSection({
  highlights,
  category,
}: HighlightsSectionProps) {
  if (!highlights || highlights.length === 0) {
    return null;
  }

  // Get icon for highlight based on category or default
  const getHighlightIcon = (index: number): string => {
    const icons = ['sparkles', 'star', 'heart', 'checkmark-circle', 'flame'];
    return icons[index % icons.length];
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="sparkles" size={20} color="#eb7825" />
        <Text style={styles.title}>Highlights</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.highlightsContainer}
      >
        {highlights.map((highlight, index) => (
          <View key={index} style={styles.highlightBadge}>
            <Ionicons
              name={getHighlightIcon(index) as any}
              size={16}
              color="#eb7825"
              style={styles.highlightIcon}
            />
            <Text style={styles.highlightText}>{highlight}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 16,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
    gap: 8,
  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    color: '#111827',
  },
  highlightsContainer: {
    paddingHorizontal: 16,
    gap: 8,
  },
  highlightBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fef3e2',
    borderWidth: 1,
    borderColor: '#fed7aa',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
  },
  highlightIcon: {
    marginRight: 2,
  },
  highlightText: {
    fontSize: 14,
    color: '#eb7825',
    fontWeight: '500',
  },
});

