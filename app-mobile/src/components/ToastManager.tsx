import React, { createContext, useContext, useRef, useState, useCallback } from 'react';
import { View, StyleSheet, Dimensions } from 'react-native';
import { Toast } from './Toast';
import { spacing, colors } from '../constants/designSystem';

interface ToastConfig {
  id: string;
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  duration?: number;
  position?: 'top' | 'bottom';
}

interface ToastContextType {
  showToast: (config: Omit<ToastConfig, 'id'>) => void;
  hideToast: (id: string) => void;
  hideAllToasts: () => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

interface ToastProviderProps {
  children: React.ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastConfig[]>([]);
  const toastIdCounter = useRef(0);

  const showToast = useCallback((config: Omit<ToastConfig, 'id'>) => {
    const id = `toast-${toastIdCounter.current++}`;
    const newToast: ToastConfig = {
      id,
      duration: 3000,
      position: 'top',
      ...config,
    };

    setToasts(prev => {
      // Remove existing toasts of the same type to prevent spam
      const filtered = prev.filter(toast => toast.type !== config.type);
      return [...filtered, newToast];
    });

    // Auto-hide after duration
    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        hideToast(id);
      }, newToast.duration);
    }
  }, []);

  const hideToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const hideAllToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const contextValue: ToastContextType = {
    showToast,
    hideToast,
    hideAllToasts,
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastContainer toasts={toasts} onHide={hideToast} />
    </ToastContext.Provider>
  );
};

interface ToastContainerProps {
  toasts: ToastConfig[];
  onHide: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onHide }) => {
  const { width } = Dimensions.get('window');

  return (
    <View style={[styles.container, { width }]} pointerEvents="box-none">
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          id={toast.id}
          message={toast.message}
          type={toast.type}
          position={toast.position || 'top'}
          onHide={onHide}
        />
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
    pointerEvents: 'box-none',
  },
});

// Convenience functions for common toast types
export const ToastManager = {
  success: (message: string, duration?: number) => ({
    message,
    type: 'success' as const,
    duration,
  }),
  
  error: (message: string, duration?: number) => ({
    message,
    type: 'error' as const,
    duration,
  }),
  
  warning: (message: string, duration?: number) => ({
    message,
    type: 'warning' as const,
    duration,
  }),
  
  info: (message: string, duration?: number) => ({
    message,
    type: 'info' as const,
    duration,
  }),
};
