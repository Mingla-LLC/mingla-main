import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Clipboard,
  Dimensions,
  SafeAreaView,
} from 'react-native';
import { debugService } from '../../services/debugService';

interface DebugModalProps {
  isVisible: boolean;
  onClose: () => void;
  viewShotRef?: any;
}

export const DebugModal: React.FC<DebugModalProps> = ({
  isVisible,
  onClose,
  viewShotRef,
}) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const scrollViewRef = useRef<ScrollView>(null);

  React.useEffect(() => {
    if (isVisible) {
      refreshLogs();
      const interval = autoRefresh ? setInterval(refreshLogs, 500) : null;
      return () => {
        if (interval) clearInterval(interval);
      };
    }
  }, [isVisible, autoRefresh]);

  const refreshLogs = () => {
    setLogs(debugService.getLogs());
  };

  const handleCopyLogs = () => {
    const formattedLogs = debugService.getLogsFormatted();
    Clipboard.setString(formattedLogs);
    Alert.alert('✅ Copied', 'Logs copied to clipboard');
  };

  const handleCopyAsJson = () => {
    const jsonLogs = debugService.getLogsAsJson();
    Clipboard.setString(jsonLogs);
    Alert.alert('✅ Copied', 'Logs (JSON) copied to clipboard');
  };

  const handleTakeScreenshot = async () => {
    if (!viewShotRef?.current) {
      Alert.alert('⚠️ Error', 'Screenshot not available');
      return;
    }

    try {
      const uri = await viewShotRef.current.capture();
      Clipboard.setString(uri);
      Alert.alert('📸 Screenshot taken', 'Path copied to clipboard:\n' + uri);
    } catch (error) {
      Alert.alert('❌ Error', 'Failed to take screenshot');
    }
  };

  const handleClearLogs = () => {
    Alert.alert('Clear Logs?', 'This will clear all logs from memory.', [
      { text: 'Cancel', onPress: () => {} },
      {
        text: 'Clear',
        onPress: () => {
          debugService.clearLogs();
          setLogs([]);
        },
      },
    ]);
  };

  const handleSaveLogs = async () => {
    const key = await debugService.saveLogs();
    if (key) {
      Alert.alert('✅ Saved', `Logs saved with key:\n${key}`);
    }
  };

  const getLogColor = (level: string) => {
    switch (level) {
      case 'error':
        return '#FF6B6B';
      case 'warn':
        return '#FFA500';
      case 'log':
        return '#70C1B3';
      case 'info':
        return '#4A90E2';
      default:
        return '#999';
    }
  };

  return (
    <Modal visible={isVisible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>🐛 Debug Console</Text>
          <View style={styles.headerStats}>
            <Text style={styles.statsText}>Logs: {logs.length}</Text>
            <TouchableOpacity onPress={() => setAutoRefresh(!autoRefresh)}>
              <Text
                style={[
                  styles.statsText,
                  { color: autoRefresh ? '#70C1B3' : '#999' },
                ]}
              >
                {autoRefresh ? '🔄 Auto' : '⏸️ Paused'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Logs */}
        <ScrollView
          ref={scrollViewRef}
          style={styles.logsContainer}
          onContentSizeChange={() => scrollViewRef.current?.scrollToEnd()}
        >
          {logs.length === 0 ? (
            <Text style={styles.emptyText}>No logs yet...</Text>
          ) : (
            logs.map((log, index) => (
              <View key={index} style={styles.logEntry}>
                <Text
                  style={[
                    styles.logLevel,
                    { color: getLogColor(log.level) },
                  ]}
                >
                  [{log.level.toUpperCase()}]
                </Text>
                <Text style={styles.logTime}>
                  {new Date(log.timestamp).toLocaleTimeString()}
                </Text>
                <Text style={styles.logMessage}>{log.message}</Text>
              </View>
            ))
          )}
        </ScrollView>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.button, styles.copyButton]}
            onPress={handleCopyLogs}
          >
            <Text style={styles.buttonText}>📋 Copy</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.jsonButton]}
            onPress={handleCopyAsJson}
          >
            <Text style={styles.buttonText}>JSON</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.saveButton]}
            onPress={handleSaveLogs}
          >
            <Text style={styles.buttonText}>💾 Save</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.clearButton]}
            onPress={handleClearLogs}
          >
            <Text style={styles.buttonText}>🗑️ Clear</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.closeButton]}
            onPress={onClose}
          >
            <Text style={styles.buttonText}>❌ Close</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1E1E1E',
  },
  header: {
    backgroundColor: '#2D2D2D',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#444',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#70C1B3',
  },
  headerStats: {
    flexDirection: 'row',
    gap: 16,
  },
  statsText: {
    fontSize: 12,
    color: '#999',
    fontWeight: '500',
  },
  logsContainer: {
    flex: 1,
    padding: 8,
  },
  logEntry: {
    backgroundColor: '#2D2D2D',
    borderLeftWidth: 3,
    borderLeftColor: '#70C1B3',
    padding: 8,
    marginBottom: 6,
    borderRadius: 4,
  },
  logLevel: {
    fontSize: 11,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  logTime: {
    fontSize: 10,
    color: '#666',
    marginBottom: 4,
  },
  logMessage: {
    fontSize: 12,
    color: '#DDD',
    fontFamily: 'Courier',
  },
  emptyText: {
    color: '#666',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 6,
    padding: 8,
    backgroundColor: '#2D2D2D',
    borderTopWidth: 1,
    borderTopColor: '#444',
    flexWrap: 'wrap',
  },
  button: {
    flex: 1,
    minWidth: '30%',
    paddingVertical: 8,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonText: {
    fontSize: 12,
    fontWeight: '600',
    color: 'white',
  },
  copyButton: {
    backgroundColor: '#70C1B3',
  },
  jsonButton: {
    backgroundColor: '#4A90E2',
  },
  saveButton: {
    backgroundColor: '#F5A623',
  },
  clearButton: {
    backgroundColor: '#E74C3C',
  },
  closeButton: {
    backgroundColor: '#666',
  },
});
