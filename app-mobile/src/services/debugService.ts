import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface LogEntry {
  level: 'log' | 'warn' | 'error' | 'info' | 'debug';
  timestamp: string;
  message: string;
  data?: string;
}

const MAX_LOGS = 200;
let logs: LogEntry[] = [];

class DebugService {
  private originalLog: any;
  private originalWarn: any;
  private originalError: any;
  private originalInfo: any;
  private isInitialized = false;

  initialize() {
    if (this.isInitialized) return;
    
    // Store original console methods
    this.originalLog = console.log;
    this.originalWarn = console.warn;
    this.originalError = console.error;
    this.originalInfo = console.info;

    // Override console methods
    console.log = this.createLogWrapper('log');
    console.warn = this.createLogWrapper('warn');
    console.error = this.createLogWrapper('error');
    console.info = this.createLogWrapper('info');
    console.debug = this.createLogWrapper('debug');

    this.isInitialized = true;
    this.originalLog('🐛 Debug Service initialized');
  }

  private createLogWrapper(level: LogEntry['level']) {
    return (...args: any[]) => {
      const originalMethod = 
        level === 'log' ? this.originalLog :
        level === 'warn' ? this.originalWarn :
        level === 'error' ? this.originalError :
        level === 'info' ? this.originalInfo :
        this.originalLog;

      // Call original console method
      originalMethod(...args);

      // Format message
      const message = args
        .map(arg => {
          if (typeof arg === 'string') return arg;
          if (typeof arg === 'object') {
            try {
              return JSON.stringify(arg, null, 2);
            } catch {
              return String(arg);
            }
          }
          return String(arg);
        })
        .join(' ');

      // Add to logs
      this.addLog(level, message);
    };
  }

  private addLog(level: LogEntry['level'], message: string) {
    const entry: LogEntry = {
      level,
      timestamp: new Date().toISOString(),
      message: message.substring(0, 500), // Limit message length
    };

    logs.push(entry);

    // Keep only last MAX_LOGS entries
    if (logs.length > MAX_LOGS) {
      logs = logs.slice(-MAX_LOGS);
    }
  }

  getLogs(): LogEntry[] {
    return [...logs];
  }

  getLogsFormatted(): string {
    return logs
      .map(
        log =>
          `[${log.timestamp}] ${log.level.toUpperCase()}: ${log.message}`
      )
      .join('\n');
  }

  getLogsAsJson(): string {
    return JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        platform: Platform.OS,
        logCount: logs.length,
        logs,
      },
      null,
      2
    );
  }

  clearLogs() {
    logs = [];
    this.originalLog('🧹 Logs cleared');
  }

  async saveLogs() {
    try {
      const logsJson = this.getLogsAsJson();
      const key = `debug_logs_${Date.now()}`;
      await AsyncStorage.setItem(key, logsJson);
      this.originalLog(`✅ Logs saved to storage: ${key}`);
      return key;
    } catch (error) {
      this.originalError('❌ Failed to save logs:', error);
      return null;
    }
  }

  async getSavedLogs() {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const logKeys = keys.filter(k => k.startsWith('debug_logs_'));
      const savedLogs = await AsyncStorage.multiGet(logKeys);
      return savedLogs.map(([key, value]) => ({
        key,
        data: value ? JSON.parse(value) : null,
      }));
    } catch (error) {
      this.originalError('❌ Failed to get saved logs:', error);
      return [];
    }
  }

  async clearSavedLogs() {
    try {
      const keys = await AsyncStorage.getAllKeys();
      const logKeys = keys.filter(k => k.startsWith('debug_logs_'));
      await AsyncStorage.multiRemove(logKeys);
      this.originalLog('🗑️ All saved logs cleared');
    } catch (error) {
      this.originalError('❌ Failed to clear saved logs:', error);
    }
  }
}

export const debugService = new DebugService();
