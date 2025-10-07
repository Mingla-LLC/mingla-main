import React, { useState } from 'react';
import { Text, View, TouchableOpacity, Image, StyleSheet, Alert, Clipboard } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { formatCurrency } from './utils/formatters';

interface PurchaseQRCodeProps {
  entry: any;
  accountPreferences?: any;
}

export default function PurchaseQRCode({ entry, accountPreferences }: PurchaseQRCodeProps) {
  const [copied, setCopied] = useState(false);

  // Generate unique purchase verification data
  const generatePurchaseData = () => {
    const purchaseId = `MGP-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
    const verificationToken = Math.random().toString(36).substr(2, 12).toUpperCase();
    
    return {
      purchaseId,
      experienceTitle: entry.experience?.title || entry.title,
      venueName: entry.experience?.address || 'Venue Location',
      purchaseOption: entry.purchaseOption?.title || 'Standard Experience',
      price: entry.purchaseOption?.price || 0,
      currency: accountPreferences?.currency || 'USD',
      purchaseDate: entry.purchaseOption?.purchasedAt || new Date().toISOString(),
      validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(), // Valid for 1 year
      verificationToken,
      customerName: userIdentity?.firstName && userIdentity?.lastName 
        ? `${userIdentity.firstName} ${userIdentity.lastName}`.trim()
        : userIdentity?.firstName || 'Customer', // This would come from user profile
      qrVersion: '1.0'
    };
  };

  const purchaseData = generatePurchaseData();

  // Generate QR code content as JSON string
  const qrContent = JSON.stringify(purchaseData);

  // For React Native, we'll use a placeholder QR code image
  // In production, you'd use a library like 'react-native-qrcode-svg' or similar
  const qrCodeDataURL = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KICA8cmVjdCB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgZmlsbD0iI2ZmZiIvPgogIDxyZWN0IHg9IjEwIiB5PSIxMCIgd2lkdGg9IjE4MCIgaGVpZ2h0PSIxODAiIGZpbGw9Im5vbmUiIHN0cm9rZT0iIzAwMCIgc3Ryb2tlLXdpZHRoPSIyIi8+CiAgPHJlY3QgeD0iMjAiIHk9IjIwIiB3aWR0aD0iMzAiIGhlaWdodD0iMzAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSIzNSIgeT0iMzUiIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgZmlsbD0iI2ZmZiIvPgogIDxyZWN0IHg9IjQwIiB5PSI0MCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjMDAwIi8+CiAgPHJlY3QgeD0iMTUwIiB5PSIyMCIgd2lkdGg9IjMwIiBoZWlnaHQ9IjMwIiBmaWxsPSIjMDAwIi8+CiAgPHJlY3QgeD0iMTY1IiB5PSIzNSIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiBmaWxsPSIjZmZmIi8+CiAgPHJlY3QgeD0iMTcwIiB5PSI0MCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjMDAwIi8+CiAgPHJlY3QgeD0iMjAiIHk9IjE1MCIgd2lkdGg9IjMwIiBoZWlnaHQ9IjMwIiBmaWxsPSIjMDAwIi8+CiAgPHJlY3QgeD0iMzUiIHk9IjE2NSIgd2lkdGg9IjIwIiBoZWlnaHQ9IjIwIiBmaWxsPSIjZmZmIi8+CiAgPHJlY3QgeD0iNDAiIHk9IjE3MCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjMDAwIi8+CiAgPHJlY3QgeD0iNjAiIHk9IjYwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSI4MCIgeT0iNjAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iIzAwMCIvPgogIDxyZWN0IHg9IjEwMCIgeT0iNjAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iIzAwMCIvPgogIDxyZWN0IHg9IjEyMCIgeT0iNjAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iIzAwMCIvPgogIDxyZWN0IHg9IjE0MCIgeT0iNjAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iIzAwMCIvPgogIDxyZWN0IHg9IjYwIiB5PSI4MCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjMDAwIi8+CiAgPHJlY3QgeD0iODAiIHk9IjgwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSIxMDAiIHk9IjgwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSIxMjAiIHk9IjgwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSIxNDAiIHk9IjgwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSI2MCIgeT0iMTAwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSI4MCIgeT0iMTAwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSIxMDAiIHk9IjEwMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjMDAwIi8+CiAgPHJlY3QgeD0iMTIwIiB5PSIxMDAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iIzAwMCIvPgogIDxyZWN0IHg9IjE0MCIgeT0iMTAwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSI2MCIgeT0iMTIwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSI4MCIgeT0iMTIwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSIxMDAiIHk9IjEyMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjMDAwIi8+CiAgPHJlY3QgeD0iMTIwIiB5PSIxMjAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iIzAwMCIvPgogIDxyZWN0IHg9IjE0MCIgeT0iMTIwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSI2MCIgeT0iMTQwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSI4MCIgeT0iMTQwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KICA8cmVjdCB4PSIxMDAiIHk9IjE0MCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjMDAwIi8+CiAgPHJlY3QgeD0iMTIwIiB5PSIxNDAiIHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iIzAwMCIvPgogIDxyZWN0IHg9IjE0MCIgeT0iMTQwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiMwMDAiLz4KPC9zdmc+';

  const handleCopyPurchaseID = async () => {
    try {
      await Clipboard.setString(purchaseData.purchaseId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy purchase ID:', err);
    }
  };

  const handleDownloadQR = () => {
    Alert.alert(
      'Download QR Code',
      'QR code download functionality would be implemented here. In a real app, you would save the QR code to the device\'s photo library.',
      [{ text: 'OK' }]
    );
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.iconContainer}>
          <Ionicons name="qr-code" size={20} color="white" />
        </View>
        <Text style={styles.title}>Purchase Verification</Text>
        <Text style={styles.subtitle}>Scan at venue for instant verification</Text>
      </View>

      {/* QR Code */}
      <View style={styles.qrCodeContainer}>
        <View style={styles.qrCodeWrapper}>
          <Image 
            source={{ uri: qrCodeDataURL }} 
            style={styles.qrCode}
          />
        </View>
      </View>

      {/* Purchase Details */}
      <View style={styles.detailsContainer}>
        {/* Purchase ID */}
        <View style={styles.purchaseIdSection}>
          <Text style={styles.purchaseIdLabel}>Purchase ID</Text>
          <View style={styles.purchaseIdRow}>
            <View style={styles.purchaseIdCode}>
              <Text style={styles.purchaseIdText}>
                {purchaseData.purchaseId}
              </Text>
            </View>
            <TouchableOpacity
              onPress={handleCopyPurchaseID}
              style={styles.copyButton}
            >
              {copied ? (
                <Ionicons name="checkmark" size={16} color="#10b981" />
              ) : (
                <Ionicons name="copy" size={16} color="#6b7280" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Actions */}
      <View style={styles.actionsContainer}>
        <TouchableOpacity
          onPress={handleDownloadQR}
          style={styles.downloadButton}
        >
          <Ionicons name="download" size={16} color="white" />
          <Text style={styles.downloadButtonText}>Download QR Code</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  header: {
    alignItems: 'center',
  },
  iconContainer: {
    width: 40,
    height: 40,
    backgroundColor: '#FF7043',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontWeight: '600',
    color: '#111827',
    fontSize: 18,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#6b7280',
  },
  qrCodeContainer: {
    alignItems: 'center',
  },
  qrCodeWrapper: {
    backgroundColor: 'white',
    padding: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  qrCode: {
    width: 160,
    height: 160,
    alignSelf: 'center',
  },
  detailsContainer: {
    backgroundColor: '#f9fafb',
    borderRadius: 8,
    padding: 12,
    gap: 8,
  },
  purchaseIdSection: {
    gap: 4,
  },
  purchaseIdLabel: {
    color: '#6b7280',
    fontWeight: '500',
    fontSize: 14,
  },
  purchaseIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  purchaseIdCode: {
    flex: 1,
    backgroundColor: 'white',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#d1d5db',
  },
  purchaseIdText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#374151',
  },
  copyButton: {
    padding: 6,
    borderRadius: 4,
  },
  actionsContainer: {
    gap: 12,
  },
  downloadButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#eb7825',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  downloadButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
});