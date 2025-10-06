import React from 'react';
import { Text, View, TouchableOpacity } from 'react-native';

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error Boundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <View className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <View className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full text-center">
            <View className="text-red-500 text-4xl mb-4">⚠️</View>
            <Text className="text-xl font-semibold text-gray-900 mb-2">Something went wrong</Text>
            <Text className="text-gray-600 mb-4">
              We encountered an unexpected error. Please refresh the page to try again.
            </Text>
            <TouchableOpacity 
              onClick={() => window.location.reload()}
              className="bg-[#eb7825] text-white px-4 py-2 rounded-lg hover:bg-[#d6691f] transition-colors"
            >
              Refresh Page
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;