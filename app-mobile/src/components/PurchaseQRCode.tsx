import React, { useState } from 'react';
import { Text, View, TouchableOpacity, Image } from 'react-native';
import { QrCode, Download, Copy, Check } from 'lucide-react';
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
      customerName: 'Jordan Smith', // This would come from user profile
      qrVersion: '1.0'
    };
  };

  const purchaseData = generatePurchaseData();

  // Generate QR code content as JSON string
  const qrContent = JSON.stringify(purchaseData);

  // Simple QR code placeholder (in a real app, you'd use a QR code library)
  const generateQRCodeDataURL = (content: string) => {
    // This is a placeholder - in production you'd use a library like 'qrcode' or similar
    // For now, we'll create a visual representation
    const size = 200;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      // Draw background
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      
      // Draw border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = 2;
      ctx.strokeRect(10, 10, size - 20, size - 20);
      
      // Draw grid pattern to simulate QR code
      ctx.fillStyle = '#000000';
      for (let i = 0; i < 15; i++) {
        for (let j = 0; j < 15; j++) {
          if (Math.random() > 0.5) {
            const cellSize = (size - 20) / 15;
            ctx.fillRect(10 + i * cellSize, 10 + j * cellSize, cellSize, cellSize);
          }
        }
      }
      
      // Draw corner markers
      const cornerSize = 30;
      ctx.fillStyle = '#000000';
      // Top-left
      ctx.fillRect(10, 10, cornerSize, cornerSize);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(20, 20, cornerSize - 20, cornerSize - 20);
      ctx.fillStyle = '#000000';
      ctx.fillRect(25, 25, cornerSize - 30, cornerSize - 30);
      
      // Top-right
      ctx.fillStyle = '#000000';
      ctx.fillRect(size - 40, 10, cornerSize, cornerSize);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(size - 30, 20, cornerSize - 20, cornerSize - 20);
      ctx.fillStyle = '#000000';
      ctx.fillRect(size - 25, 25, cornerSize - 30, cornerSize - 30);
      
      // Bottom-left
      ctx.fillStyle = '#000000';
      ctx.fillRect(10, size - 40, cornerSize, cornerSize);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(20, size - 30, cornerSize - 20, cornerSize - 20);
      ctx.fillStyle = '#000000';
      ctx.fillRect(25, size - 25, cornerSize - 30, cornerSize - 30);
    }
    
    return canvas.toDataURL();
  };

  const qrCodeDataURL = generateQRCodeDataURL(qrContent);

  const handleCopyPurchaseID = async () => {
    try {
      await navigator.clipboard.writeText(purchaseData.purchaseId);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy purchase ID:', err);
    }
  };

  const handleDownloadQR = () => {
    const link = document.createElement('a');
    link.download = `mingla-purchase-qr-${purchaseData.purchaseId}.png`;
    link.href = qrCodeDataURL;
    link.click();
  };

  return (
    <View className="space-y-4">
      {/* Header */}
      <View className="text-center">
        <View className="w-10 h-10 bg-gradient-to-br from-[#FF7043] to-[#FF5722] rounded-full flex items-center justify-center mx-auto mb-2">
          <QrCode className="w-5 h-5 text-white" />
        </View>
        <Text className="font-semibold text-gray-900 mb-1">Purchase Verification</Text>
        <Text className="text-sm text-gray-600">Scan at venue for instant verification</Text>
      </View>

      {/* QR Code */}
      <View className="flex justify-center">
        <View className="bg-white p-3 rounded-lg border-2 border-gray-200 shadow-sm">
          <Image 
            source={{ uri: qrCodeDataURL }} 
            style={{ width: 160, height: 160, alignSelf: 'center' }}
          />
        </View>
      </View>

      {/* Purchase Details */}
      <View className="bg-gray-50 rounded-lg p-3 space-y-2">
        {/* Purchase ID */}
        <View>
          <Text className="text-gray-500 font-medium text-sm mb-1">Purchase ID</Text>
          <View className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white px-2 py-1 rounded border font-mono">
              {purchaseData.purchaseId}
            </code>
            <TouchableOpacity
              onClick={handleCopyPurchaseID}
              className="p-1.5 text-gray-500 hover:text-[#eb7825] hover:bg-[#eb7825]/5 rounded transition-colors"
              title="Copy Purchase ID"
            >
              {copied ? (
                <Check className="w-4 h-4 text-green-500" />
              ) : (
                <Copy className="w-4 h-4" />
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>

      {/* Actions */}
      <View className="flex gap-3">
        <TouchableOpacity
          onClick={handleDownloadQR}
          className="flex-1 flex items-center justify-center gap-2 bg-[#eb7825] text-white py-2.5 px-4 rounded-lg hover:bg-[#d6691f] transition-colors"
        >
          <Download className="w-4 h-4" />
          Download QR Code
        </TouchableOpacity>
      </View>
    </View>
  );
}