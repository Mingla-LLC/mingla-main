import React, { useState } from 'react';
import { X, QrCode, CheckCircle, XCircle, AlertCircle, Scan } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';

interface QRCodeValidationModalProps {
  isOpen: boolean;
  onClose: () => void;
  businessId: string;
  businessName: string;
}

interface Purchase {
  id: string;
  experienceId: string;
  experienceName: string;
  buyerName: string;
  buyerEmail: string;
  amount: number;
  packageTitle: string;
  purchaseDate: string;
  qrCode: string;
  redeemed: boolean;
  redeemedAt?: string;
  businessId?: string;
  curatorId?: string;
  curatorCommission?: number;
}

export default function QRCodeValidationModal({ 
  isOpen, 
  onClose,
  businessId,
  businessName 
}: QRCodeValidationModalProps) {
  const [qrCodeInput, setQrCodeInput] = useState('');
  const [validationResult, setValidationResult] = useState<{
    success: boolean;
    message: string;
    purchase?: Purchase;
  } | null>(null);
  const [isValidating, setIsValidating] = useState(false);

  const handleValidate = () => {
    setIsValidating(true);
    setValidationResult(null);

    // Simulate scanning delay
    setTimeout(() => {
      // Get all purchases
      const allPurchases: Purchase[] = JSON.parse(localStorage.getItem('purchases') || '[]');
      
      // Find purchase by QR code
      const purchase = allPurchases.find(p => p.qrCode === qrCodeInput.trim());

      if (!purchase) {
        setValidationResult({
          success: false,
          message: 'Invalid QR code. Purchase not found.'
        });
        setIsValidating(false);
        return;
      }

      // Check if purchase is for this business
      if (purchase.businessId !== businessId) {
        setValidationResult({
          success: false,
          message: `This purchase is for a different business. Please validate at ${purchase.businessId || 'the correct location'}.`
        });
        setIsValidating(false);
        return;
      }

      // Check if already redeemed
      if (purchase.redeemed) {
        setValidationResult({
          success: false,
          message: `This purchase was already redeemed on ${new Date(purchase.redeemedAt!).toLocaleDateString()}.`,
          purchase
        });
        setIsValidating(false);
        return;
      }

      // Mark as redeemed
      const updatedPurchases = allPurchases.map(p => 
        p.id === purchase.id 
          ? { ...p, redeemed: true, redeemedAt: new Date().toISOString() }
          : p
      );
      localStorage.setItem('purchases', JSON.stringify(updatedPurchases));

      setValidationResult({
        success: true,
        message: 'Purchase validated successfully!',
        purchase: { ...purchase, redeemed: true, redeemedAt: new Date().toISOString() }
      });
      setIsValidating(false);
      setQrCodeInput('');

      // Trigger storage event to update other components
      window.dispatchEvent(new Event('storage'));
    }, 800);
  };

  const handleReset = () => {
    setQrCodeInput('');
    setValidationResult(null);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999]" data-modal-portal="true">
          {/* Backdrop - handles click-outside-to-close */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            style={{ pointerEvents: 'auto' }}
          />
          
          {/* Container - layout only, no pointer events */}
          <div className="absolute inset-0 flex items-center justify-center p-4" style={{ pointerEvents: 'none' }}>
            {/* Content - captures all interactions */}
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl relative"
              style={{ pointerEvents: 'auto' }}
            >
            {/* Header */}
            <div className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] px-6 py-4 flex items-center justify-between">
              <div>
                <h2 className="text-white text-xl">Validate Purchase</h2>
                <p className="text-white/80 text-sm mt-1">{businessName}</p>
              </div>
              <button
                onClick={onClose}
                className="text-white/80 hover:text-white transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6">
              {!validationResult ? (
                <div className="space-y-6">
                  {/* QR Scanner Placeholder */}
                  <div className="aspect-square bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl flex items-center justify-center border-2 border-dashed border-gray-300">
                    <div className="text-center">
                      <Scan className="w-16 h-16 text-gray-400 mx-auto mb-3" />
                      <p className="text-gray-500 text-sm">QR Scanner</p>
                      <p className="text-gray-400 text-xs mt-1">Camera access would enable here</p>
                    </div>
                  </div>

                  {/* Manual Entry */}
                  <div>
                    <label className="block text-gray-700 mb-2 text-sm">
                      Or enter QR code manually
                    </label>
                    <div className="flex gap-2">
                      <Input
                        value={qrCodeInput}
                        onChange={(e) => setQrCodeInput(e.target.value)}
                        placeholder="Enter QR code"
                        className="flex-1 rounded-xl"
                        onKeyDown={(e) => e.key === 'Enter' && qrCodeInput && handleValidate()}
                      />
                      <Button
                        onClick={handleValidate}
                        disabled={!qrCodeInput || isValidating}
                        className="bg-[#eb7825] hover:bg-[#d6691f] text-white rounded-xl px-6"
                      >
                        {isValidating ? 'Validating...' : 'Validate'}
                      </Button>
                    </div>
                  </div>

                  {/* Instructions */}
                  <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
                    <div className="flex gap-3">
                      <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-blue-900 text-sm mb-1">How to validate</p>
                        <ul className="text-blue-700 text-xs space-y-1">
                          <li>• Ask customer to show their QR code</li>
                          <li>• Scan using camera or enter code manually</li>
                          <li>• Verify customer details match</li>
                          <li>• Mark as redeemed to complete</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Validation Result */}
                  <div className={`rounded-xl p-6 text-center ${
                    validationResult.success 
                      ? 'bg-green-50 border-2 border-green-200' 
                      : 'bg-red-50 border-2 border-red-200'
                  }`}>
                    {validationResult.success ? (
                      <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
                    ) : (
                      <XCircle className="w-16 h-16 text-red-600 mx-auto mb-4" />
                    )}
                    <h3 className={`text-xl mb-2 ${
                      validationResult.success ? 'text-green-900' : 'text-red-900'
                    }`}>
                      {validationResult.success ? 'Validated!' : 'Validation Failed'}
                    </h3>
                    <p className={`text-sm ${
                      validationResult.success ? 'text-green-700' : 'text-red-700'
                    }`}>
                      {validationResult.message}
                    </p>
                  </div>

                  {/* Purchase Details */}
                  {validationResult.purchase && (
                    <div className="bg-white border border-gray-200 rounded-xl p-4 space-y-3">
                      <div className="flex items-start justify-between">
                        <div>
                          <h4 className="text-gray-900 mb-1">{validationResult.purchase.experienceName}</h4>
                          <p className="text-gray-600 text-sm">{validationResult.purchase.packageTitle}</p>
                        </div>
                        {validationResult.purchase.redeemed && (
                          <Badge className="bg-green-100 text-green-700">
                            Redeemed
                          </Badge>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-3 pt-3 border-t border-gray-100">
                        <div>
                          <div className="text-xs text-gray-500">Customer</div>
                          <div className="text-gray-900 text-sm">{validationResult.purchase.buyerName}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Amount</div>
                          <div className="text-gray-900 text-sm">${validationResult.purchase.amount}</div>
                        </div>
                        <div>
                          <div className="text-xs text-gray-500">Purchase Date</div>
                          <div className="text-gray-900 text-sm">
                            {new Date(validationResult.purchase.purchaseDate).toLocaleDateString()}
                          </div>
                        </div>
                        {validationResult.purchase.redeemedAt && (
                          <div>
                            <div className="text-xs text-gray-500">Redeemed</div>
                            <div className="text-gray-900 text-sm">
                              {new Date(validationResult.purchase.redeemedAt).toLocaleDateString()}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-3">
                    <Button
                      onClick={handleReset}
                      variant="outline"
                      className="flex-1 rounded-xl"
                    >
                      Validate Another
                    </Button>
                    <Button
                      onClick={onClose}
                      className="flex-1 bg-[#eb7825] hover:bg-[#d6691f] text-white rounded-xl"
                    >
                      Done
                    </Button>
                  </div>
                </div>
              )}
            </div>
            </motion.div>
          </div>
        </div>
      )}
    </AnimatePresence>
  );
}
