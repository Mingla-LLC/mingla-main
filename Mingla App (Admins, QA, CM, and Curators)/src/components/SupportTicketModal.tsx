import React, { useState, useRef, useEffect } from 'react';
import { X, AlertCircle, Bug, Lightbulb, HelpCircle, Upload, CheckCircle, FileText, Image as ImageIcon, FileIcon, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';

interface SupportTicketModalProps {
  isOpen: boolean;
  onClose: () => void;
  curatorData?: {
    name: string;
    email: string;
  };
  preSelectedType?: 'bug' | 'issue' | 'feature' | null;
}

type TicketType = 'bug' | 'issue' | 'feature' | null;

export default function SupportTicketModal({ isOpen, onClose, curatorData, preSelectedType }: SupportTicketModalProps) {
  const [step, setStep] = useState<'type' | 'details' | 'submitted'>('type');
  const [ticketType, setTicketType] = useState<TicketType>(null);
  const [submittedTicketId, setSubmittedTicketId] = useState('');
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    priority: 'medium',
    attachments: [] as File[]
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-select ticket type and skip to details if pre-selected
  useEffect(() => {
    if (isOpen) {
      if (preSelectedType) {
        setTicketType(preSelectedType);
        setStep('details');
      } else {
        // Reset to type selection if no pre-selection
        setStep('type');
        setTicketType(null);
      }
      // Reset form data when opening
      setFormData({ title: '', description: '', priority: 'medium', attachments: [] });
    }
  }, [isOpen, preSelectedType]);

  const ticketTypes = [
    {
      id: 'bug' as const,
      icon: Bug,
      title: 'Report a Bug',
      description: 'Something isn\'t working as expected',
      color: 'from-red-50 to-rose-50',
      borderColor: 'border-red-200',
      iconColor: 'text-red-600',
      bgColor: 'bg-red-100'
    },
    {
      id: 'issue' as const,
      icon: AlertCircle,
      title: 'Report an Issue',
      description: 'You\'re experiencing a problem',
      color: 'from-orange-50 to-amber-50',
      borderColor: 'border-orange-200',
      iconColor: 'text-orange-600',
      bgColor: 'bg-orange-100'
    },
    {
      id: 'feature' as const,
      icon: Lightbulb,
      title: 'Suggest a Feature',
      description: 'Share your ideas to improve Mingla',
      color: 'from-blue-50 to-indigo-50',
      borderColor: 'border-blue-200',
      iconColor: 'text-blue-600',
      bgColor: 'bg-blue-100'
    }
  ];

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const validFiles = files.filter(file => {
      const isValidType = ['image/png', 'image/jpeg', 'image/jpg', 'application/pdf'].includes(file.type);
      const isValidSize = file.size <= 10 * 1024 * 1024; // 10MB
      return isValidType && isValidSize;
    });

    setFormData({
      ...formData,
      attachments: [...formData.attachments, ...validFiles]
    });

    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleRemoveFile = (index: number) => {
    setFormData({
      ...formData,
      attachments: formData.attachments.filter((_, i) => i !== index)
    });
  };

  const getFileIcon = (file: File) => {
    if (file.type.startsWith('image/')) return ImageIcon;
    if (file.type === 'application/pdf') return FileText;
    return FileIcon;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const handleSubmit = () => {
    const ticketId = Math.random().toString(36).substring(2, 10).toUpperCase();
    setSubmittedTicketId(ticketId);
    
    // In production, this would:
    // 1. Upload files to Supabase Storage
    // 2. Create ticket record in Supabase database with file URLs
    // 3. Send notification to QA team
    const ticketData = {
      id: ticketId,
      type: ticketType,
      title: formData.title,
      description: formData.description,
      priority: formData.priority,
      attachments: formData.attachments.map(f => ({
        name: f.name,
        size: f.size,
        type: f.type,
        // In production, this would be the Supabase Storage URL
        url: URL.createObjectURL(f)
      })),
      submittedBy: {
        name: curatorData?.name,
        email: curatorData?.email
      },
      status: 'new',
      createdAt: new Date().toISOString()
    };
    
    console.log('Ticket submitted:', ticketData);
    
    // Store in localStorage for demo (will be replaced with Supabase)
    const existingTickets = JSON.parse(localStorage.getItem('supportTickets') || '[]');
    localStorage.setItem('supportTickets', JSON.stringify([...existingTickets, ticketData]));
    
    setStep('submitted');
    
    // Reset after 3 seconds
    setTimeout(() => {
      onClose();
      setStep('type');
      setTicketType(null);
      setFormData({ title: '', description: '', priority: 'medium', attachments: [] });
    }, 3000);
  };

  const handleClose = () => {
    onClose();
    setStep('type');
    setTicketType(null);
    setFormData({ title: '', description: '', priority: 'medium', attachments: [] });
  };

  const selectedType = ticketTypes.find(t => t.id === ticketType);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden"
          >
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
              <div>
                <h3 className="text-gray-900">Submit Support Ticket</h3>
                <p className="text-sm text-gray-500 mt-0.5">
                  {step === 'type' && 'Choose the type of request'}
                  {step === 'details' && 'Provide detailed information'}
                  {step === 'submitted' && 'Ticket submitted successfully'}
                </p>
              </div>
              <button
                onClick={handleClose}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="overflow-y-auto max-h-[calc(90vh-140px)]">
              {/* Step 1: Select Type */}
              {step === 'type' && (
                <div className="p-6 space-y-4">
                  {ticketTypes.map((type) => {
                    const Icon = type.icon;
                    return (
                      <button
                        key={type.id}
                        onClick={() => setTicketType(type.id)}
                        className={`w-full p-5 rounded-xl border-2 transition-all text-left ${
                          ticketType === type.id
                            ? `${type.borderColor} bg-gradient-to-br ${type.color} shadow-md`
                            : 'border-gray-200 hover:border-gray-300 bg-white'
                        }`}
                      >
                        <div className="flex items-start gap-4">
                          <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                            ticketType === type.id ? type.bgColor : 'bg-gray-100'
                          }`}>
                            <Icon className={`w-6 h-6 ${
                              ticketType === type.id ? type.iconColor : 'text-gray-600'
                            }`} />
                          </div>
                          <div className="flex-1">
                            <h4 className="text-gray-900 mb-1">{type.title}</h4>
                            <p className="text-sm text-gray-600">{type.description}</p>
                          </div>
                          {ticketType === type.id && (
                            <CheckCircle className={`w-6 h-6 ${type.iconColor} flex-shrink-0`} />
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* Step 2: Details */}
              {step === 'details' && selectedType && (
                <div className="p-6 space-y-5">
                  {/* Ticket Type Badge */}
                  <div className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-br ${selectedType.color} border ${selectedType.borderColor}`}>
                    {React.createElement(selectedType.icon, { 
                      className: `w-4 h-4 ${selectedType.iconColor}` 
                    })}
                    <span className={`text-sm ${selectedType.iconColor}`}>
                      {selectedType.title}
                    </span>
                  </div>

                  {/* Form */}
                  <div className="space-y-4">
                    <div>
                      <label className="text-sm text-gray-700 mb-1.5 block">
                        Title <span className="text-red-500">*</span>
                      </label>
                      <Input
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        placeholder={
                          ticketType === 'bug' ? 'e.g., Cards not loading on dashboard' :
                          ticketType === 'issue' ? 'e.g., Cannot upload images' :
                          'e.g., Add bulk edit feature for cards'
                        }
                        className="rounded-xl"
                      />
                    </div>

                    <div>
                      <label className="text-sm text-gray-700 mb-1.5 block">
                        Description <span className="text-red-500">*</span>
                      </label>
                      <Textarea
                        value={formData.description}
                        onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                        placeholder={
                          ticketType === 'bug' ? 'Please describe the bug in detail:\n• What were you doing when it occurred?\n• What did you expect to happen?\n• What actually happened?\n• Can you reproduce it?' :
                          ticketType === 'issue' ? 'Please describe the issue:\n• What problem are you facing?\n• When did it start?\n• Have you tried any troubleshooting steps?' :
                          'Please describe your feature idea:\n• What problem would it solve?\n• How should it work?\n• Any examples or references?'
                        }
                        rows={8}
                        className="rounded-xl resize-none"
                      />
                    </div>

                    {(ticketType === 'bug' || ticketType === 'issue') && (
                      <div>
                        <label className="text-sm text-gray-700 mb-1.5 block">
                          Priority
                        </label>
                        <select
                          value={formData.priority}
                          onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
                          className="w-full px-4 py-2.5 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
                        >
                          <option value="low">Low - Minor inconvenience</option>
                          <option value="medium">Medium - Affects workflow</option>
                          <option value="high">High - Blocking my work</option>
                          <option value="critical">Critical - Platform unusable</option>
                        </select>
                      </div>
                    )}

                    <div>
                      <label className="text-sm text-gray-700 mb-1.5 block">
                        Attachments (Optional)
                      </label>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/jpg,application/pdf"
                        multiple
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <div 
                        onClick={() => fileInputRef.current?.click()}
                        className="border-2 border-dashed border-gray-300 rounded-xl p-6 text-center hover:border-[#eb7825] transition-colors cursor-pointer"
                      >
                        <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
                        <p className="text-sm text-gray-600 mb-1">
                          Click to upload screenshots or files
                        </p>
                        <p className="text-xs text-gray-400">
                          PNG, JPG, PDF up to 10MB each
                        </p>
                      </div>

                      {/* Uploaded Files List */}
                      {formData.attachments.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {formData.attachments.map((file, index) => {
                            const FileIconComponent = getFileIcon(file);
                            return (
                              <div
                                key={index}
                                className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200"
                              >
                                <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center border border-gray-200">
                                  <FileIconComponent className="w-5 h-5 text-gray-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-gray-900 truncate">{file.name}</p>
                                  <p className="text-xs text-gray-500">{formatFileSize(file.size)}</p>
                                </div>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleRemoveFile(index);
                                  }}
                                  className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* User Info */}
                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-200">
                      <div className="text-sm text-gray-600 mb-2">Contact Information</div>
                      <div className="space-y-1">
                        <div className="text-sm text-gray-900">{curatorData?.name}</div>
                        <div className="text-sm text-gray-600">{curatorData?.email}</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Step 3: Submitted */}
              {step === 'submitted' && (
                <div className="p-12 text-center">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', duration: 0.5 }}
                    className="w-20 h-20 bg-gradient-to-br from-green-100 to-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6"
                  >
                    <CheckCircle className="w-10 h-10 text-green-600" />
                  </motion.div>
                  <h3 className="text-gray-900 mb-2">Ticket Submitted Successfully!</h3>
                  <p className="text-gray-600 mb-6">
                    We've received your {ticketType} report. Our support team will review it and get back to you within 24 hours.
                  </p>
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-200 inline-block">
                    <p className="text-sm text-blue-900">
                      Ticket ID: <span className="font-mono">#{submittedTicketId}</span>
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            {step !== 'submitted' && (
              <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex gap-3 justify-end">
                {step === 'details' && (
                  <Button
                    variant="outline"
                    onClick={() => setStep('type')}
                  >
                    Back
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={handleClose}
                >
                  Cancel
                </Button>
                {step === 'type' && (
                  <Button
                    onClick={() => setStep('details')}
                    disabled={!ticketType}
                    className="bg-gradient-to-r from-[#eb7825] to-[#d6691f]"
                  >
                    Continue
                  </Button>
                )}
                {step === 'details' && (
                  <Button
                    onClick={handleSubmit}
                    disabled={!formData.title.trim() || !formData.description.trim()}
                    className="bg-gradient-to-r from-[#eb7825] to-[#d6691f]"
                  >
                    Submit Ticket
                  </Button>
                )}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
