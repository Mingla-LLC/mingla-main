import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { Icon } from '../ui/Icon';

// Dynamic import to handle cases where the library might not be available
let QRCode: any = null;
try {
  QRCode = require('react-native-qrcode-svg').default;
} catch (error) {
  console.warn('react-native-qrcode-svg not available, using fallback');
}

interface QRCodeDisplayProps {
  data: string;
  size?: number;
}

// Fallback QR Code component using simple pattern
const FallbackQRCode: React.FC<{ data: string; size: number }> = ({ data, size }) => {
  return (
    <View style={[styles.fallbackContainer, { width: size, height: size }]}>
      <Icon name="qr-code-outline" size={size * 0.4} color="#007AFF" />
      <Text style={styles.fallbackText}>QR Code</Text>
      <Text style={styles.fallbackData} numberOfLines={2} ellipsizeMode="middle">
        {data}
      </Text>
    </View>
  );
};

export const QRCodeDisplay: React.FC<QRCodeDisplayProps> = ({
  data,
  size = 200,
}) => {
  const [hasError, setHasError] = useState(false);

  if (!data || data.trim().length === 0) {
    return (
      <View style={styles.container}>
        <View style={[styles.qrCodeContainer, { width: size + 40, height: size + 40 }]}>
          <View style={styles.errorContainer}>
            <Icon name="alert-circle-outline" size={48} color="#FF3B30" />
            <Text style={styles.errorText}>No Data</Text>
            <Text style={styles.errorSubtext}>Cannot generate QR code without data</Text>
          </View>
        </View>
      </View>
    );
  }

  // Use fallback if library is not available or error occurred
  if (!QRCode || hasError) {
    return (
      <View style={styles.container}>
        <View style={[styles.qrCodeContainer, { width: size + 40, height: size + 40 }]}>
          <FallbackQRCode data={data} size={size} />
        </View>
        <Text style={styles.instruction}>
          Scan this QR code to join the board session
        </Text>
        <View style={styles.dataContainer}>
          <Text style={styles.dataLabel}>Or use this code:</Text>
          <Text style={styles.codeText} selectable>
            {data.length > 30 ? `${data.substring(0, 15)}...${data.substring(data.length - 15)}` : data}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.qrCodeContainer, { width: size + 40, height: size + 40 }]}>
        <View style={styles.qrCodeWrapper}>
          <QRCode
            value={data}
            size={size}
            color="#000000"
            backgroundColor="#FFFFFF"
            quietZone={10}
            ecl="M"
            onError={(error: any) => {
              console.error('QR Code generation error:', error);
              setHasError(true);
            }}
          />
        </View>
        {/* Quiet zone border for visual clarity */}
        <View style={styles.quietZone} />
      </View>
      <Text style={styles.instruction}>
        Scan this QR code to join the board session
      </Text>
      <View style={styles.dataContainer}>
        <Text style={styles.dataLabel}>Or use this code:</Text>
        <Text style={styles.codeText} selectable>
          {data.length > 30 ? `${data.substring(0, 15)}...${data.substring(data.length - 15)}` : data}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    padding: 20,
  },
  qrCodeContainer: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#e1e5e9',
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  qrCodeWrapper: {
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 4,
  },
  quietZone: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: 4,
    borderColor: 'white',
    borderRadius: 12,
    pointerEvents: 'none',
  },
  fallbackContainer: {
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  fallbackText: {
    fontSize: 16,
    color: '#666',
    marginTop: 12,
    fontWeight: '500',
  },
  fallbackData: {
    fontSize: 10,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
    maxWidth: '90%',
  },
  errorContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
    minHeight: 200,
  },
  errorText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#FF3B30',
    marginTop: 12,
  },
  errorSubtext: {
    fontSize: 12,
    color: '#666',
    marginTop: 4,
    textAlign: 'center',
  },
  instruction: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginBottom: 12,
    fontWeight: '500',
  },
  dataContainer: {
    alignItems: 'center',
    marginTop: 8,
    paddingHorizontal: 20,
  },
  dataLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  codeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#007AFF',
    letterSpacing: 1,
    fontFamily: 'monospace',
    textAlign: 'center',
  },
});
