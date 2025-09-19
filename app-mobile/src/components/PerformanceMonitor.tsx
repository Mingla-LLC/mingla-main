import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface PerformanceMetrics {
  renderTime: number;
  memoryUsage: number;
  networkRequests: number;
  cacheHitRate: number;
}

interface PerformanceMonitorProps {
  enabled?: boolean;
  onToggle?: (enabled: boolean) => void;
}

export const PerformanceMonitor: React.FC<PerformanceMonitorProps> = ({
  enabled = false,
  onToggle,
}) => {
  const [metrics, setMetrics] = useState<PerformanceMetrics>({
    renderTime: 0,
    memoryUsage: 0,
    networkRequests: 0,
    cacheHitRate: 0,
  });
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      // Simulate performance monitoring
      setMetrics(prev => ({
        renderTime: Math.random() * 100,
        memoryUsage: Math.random() * 100,
        networkRequests: Math.floor(Math.random() * 10),
        cacheHitRate: Math.random() * 100,
      }));
    }, 1000);

    return () => clearInterval(interval);
  }, [enabled]);

  if (!enabled) return null;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.toggleButton}
        onPress={() => setIsVisible(!isVisible)}
      >
        <Ionicons name="speedometer" size={16} color="white" />
        <Text style={styles.toggleText}>Perf</Text>
      </TouchableOpacity>

      {isVisible && (
        <View style={styles.metricsPanel}>
          <View style={styles.header}>
            <Text style={styles.title}>Performance Metrics</Text>
            <TouchableOpacity onPress={() => onToggle?.(false)}>
              <Ionicons name="close" size={16} color="#666" />
            </TouchableOpacity>
          </View>

          <View style={styles.metrics}>
            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Render Time</Text>
              <Text style={styles.metricValue}>{metrics.renderTime.toFixed(1)}ms</Text>
            </View>

            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Memory Usage</Text>
              <Text style={styles.metricValue}>{metrics.memoryUsage.toFixed(1)}%</Text>
            </View>

            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Network Requests</Text>
              <Text style={styles.metricValue}>{metrics.networkRequests}</Text>
            </View>

            <View style={styles.metric}>
              <Text style={styles.metricLabel}>Cache Hit Rate</Text>
              <Text style={styles.metricValue}>{metrics.cacheHitRate.toFixed(1)}%</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 50,
    right: 16,
    zIndex: 1000,
  },
  toggleButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    gap: 4,
  },
  toggleText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  metricsPanel: {
    position: 'absolute',
    top: 30,
    right: 0,
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 12,
    minWidth: 200,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1a1a1a',
  },
  metrics: {
    gap: 6,
  },
  metric: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metricLabel: {
    fontSize: 12,
    color: '#666',
  },
  metricValue: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1a1a1a',
  },
});
