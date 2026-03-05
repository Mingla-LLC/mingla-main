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

/** Serialize any value — extracts stack traces from Error objects */
function serialize(arg: any): string {
  if (arg instanceof Error) {
    return `${arg.name}: ${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
  }
  if (typeof arg === 'string') return arg;
  if (typeof arg === 'object' && arg !== null) {
    try {
      return JSON.stringify(arg, null, 2);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
}

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

    // Catch unhandled JS exceptions (red screen errors)
    this.installGlobalErrorHandlers();

    this.isInitialized = true;
    this.originalLog('🐛 Debug Service initialized (global error handlers active)');
  }

  /** Install global handlers for uncaught errors + unhandled promise rejections */
  private installGlobalErrorHandlers() {
    // 1. Uncaught JS exceptions via React Native's ErrorUtils
    const g = global as any;
    if (g.ErrorUtils) {
      const prevHandler = g.ErrorUtils.getGlobalHandler();
      g.ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
        const tag = isFatal ? 'FATAL' : 'UNCAUGHT';
        this.originalError(
          `[${tag}] ${error.name}: ${error.message}\n${error.stack ?? '(no stack)'}`
        );
        this.addLog('error', `[${tag}] ${serialize(error)}`);
        // Forward to the previous handler so the red screen still shows
        if (prevHandler) prevHandler(error, isFatal);
      });
    }

    // 2. Unhandled promise rejections
    // RN's default handler sends these to LogBox (device overlay) in dev mode,
    // which does NOT appear in Metro terminal. We re-enable tracking so
    // rejections are also printed to console.error → Metro terminal.
    try {
      const tracking = require('promise/setimmediate/rejection-tracking');
      tracking.disable(); // Clear RN's existing handler to avoid double-fire
      tracking.enable({
        allRejections: true,
        onUnhandled: (id: number, error: any) => {
          const msg = error instanceof Error ? serialize(error) : String(error);
          this.originalError(`[UNHANDLED_PROMISE id=${id}] ${msg}`);
          this.addLog('error', `[UNHANDLED_PROMISE id=${id}] ${msg}`);
        },
        onHandled: (_id: number) => {
          // Rejection was handled late — no action needed
        },
      });
    } catch {
      // If promise tracking module isn't available, skip silently
    }
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

      // Format message — use serialize() so Error stacks are captured
      const message = args.map(serialize).join(' ');

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
