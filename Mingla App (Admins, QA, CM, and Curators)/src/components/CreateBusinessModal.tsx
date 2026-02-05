import React, { useState, useEffect } from 'react';
import { X, Upload, Building2, Globe, FileText, CheckCircle, AlertCircle, Mail, UserPlus, Trash2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getPlatformCommission } from './utils/platformSettings';
import { toast } from 'sonner@2.0.3';

interface CreateBusinessModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateBusiness: (businessData: any) => void;
  curatorId: string;
  editMode?: boolean;
  existingBusiness?: any;
}

export default function CreateBusinessModal({
  isOpen,
  onClose,
  onCreateBusiness,
  curatorId,
  editMode = false,
  existingBusiness
}: CreateBusinessModalProps) {
  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState({
    name: '',
    logo: '',
    website: '',
    description: '',
    category: '',
    location: '',
    contactEmail: '',
    contactPhone: '',
    curatorCommission: 15,
    invitedUsers: [] as { email: string; name: string }[]
  });
  const [errors, setErrors] = useState<any>({});
  const [logoPreview, setLogoPreview] = useState('');
  const [platformCommission, setPlatformCommission] = useState(getPlatformCommission());
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserName, setNewUserName] = useState('');

  // Reset form when modal opens or when existingBusiness changes
  useEffect(() => {
    if (isOpen) {
      if (existingBusiness) {
        setFormData({
          name: existingBusiness.name || '',
          logo: existingBusiness.logo || '',
          website: existingBusiness.website || '',
          description: existingBusiness.description || '',
          category: existingBusiness.category || '',
          location: existingBusiness.location || '',
          contactEmail: existingBusiness.contactEmail || '',
          contactPhone: existingBusiness.contactPhone || '',
          curatorCommission: existingBusiness.curatorCommission || 15,
          invitedUsers: existingBusiness.invitedUsers || []
        });
        setLogoPreview(existingBusiness.logo || '');
      } else {
        setFormData({
          name: '',
          logo: '',
          website: '',
          description: '',
          category: '',
          location: '',
          contactEmail: '',
          contactPhone: '',
          curatorCommission: 15,
          invitedUsers: []
        });
        setLogoPreview('');
      }
      setStep(1);
      setErrors({});
      setNewUserEmail('');
      setNewUserName('');
    }
  }, [isOpen, existingBusiness]);

  // Listen for platform commission changes
  useEffect(() => {
    const handleStorageChange = () => {
      setPlatformCommission(getPlatformCommission());
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  if (!isOpen) return null;

  const validateStep1 = () => {
    const newErrors: any = {};
    if (!formData.name.trim()) newErrors.name = 'Business name is required';
    if (!formData.category) newErrors.category = 'Category is required';
    if (!formData.description.trim()) newErrors.description = 'Description is required';
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep2 = () => {
    const newErrors: any = {};
    if (formData.website && !formData.website.match(/^https?:\/\/.+/)) {
      newErrors.website = 'Please enter a valid URL (e.g., https://example.com)';
    }
    if (formData.contactEmail && !formData.contactEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      newErrors.contactEmail = 'Please enter a valid email address';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateStep3 = () => {
    const newErrors: any = {};
    if (formData.invitedUsers.length === 0) {
      newErrors.invitedUsers = 'You must invite at least one business user';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleNext = () => {
    if (step === 1 && validateStep1()) {
      setStep(2);
    } else if (step === 2 && validateStep2()) {
      setStep(3);
    }
  };

  const handleAddUser = () => {
    if (!newUserEmail.trim()) {
      toast.error('Please enter an email address');
      return;
    }
    if (!newUserEmail.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
      toast.error('Please enter a valid email address');
      return;
    }
    if (!newUserName.trim()) {
      toast.error('Please enter a name');
      return;
    }
    
    // Check for duplicate
    if (formData.invitedUsers.some(u => u.email.toLowerCase() === newUserEmail.toLowerCase())) {
      toast.error('This user has already been invited');
      return;
    }

    setFormData({
      ...formData,
      invitedUsers: [...formData.invitedUsers, { email: newUserEmail, name: newUserName }]
    });
    setNewUserEmail('');
    setNewUserName('');
    toast.success(`Invitation prepared for ${newUserName}`);
  };

  const handleRemoveUser = (email: string) => {
    setFormData({
      ...formData,
      invitedUsers: formData.invitedUsers.filter(u => u.email !== email)
    });
    toast.success('User removed from invitation list');
  };

  const handleSubmit = () => {
    if (!validateStep3()) return;

    const businessData = {
      id: existingBusiness?.id || `business-${Date.now()}`,
      ...formData,
      curatorId,
      createdAt: existingBusiness?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'pending', // Business is pending until a user accepts the invitation
      commissionStatus: 'pending', // Commission needs approval from business
    };

    // Create invitations in localStorage
    const invitations = JSON.parse(localStorage.getItem('business_invitations') || '[]');
    formData.invitedUsers.forEach(user => {
      invitations.push({
        id: `invitation-${Date.now()}-${Math.random()}`,
        businessId: businessData.id,
        businessName: businessData.name,
        curatorId,
        curatorName: localStorage.getItem('currentUser') ? JSON.parse(localStorage.getItem('currentUser') || '{}').name : 'Curator',
        invitedEmail: user.email,
        invitedName: user.name,
        commission: formData.curatorCommission,
        status: 'pending', // pending, accepted, rejected
        sentAt: new Date().toISOString(),
      });
    });
    localStorage.setItem('business_invitations', JSON.stringify(invitations));

    onCreateBusiness(businessData);
    toast.success(`Business created! ${formData.invitedUsers.length} invitation(s) sent.`);
    onClose();
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        setLogoPreview(result);
        setFormData({ ...formData, logo: result });
      };
      reader.readAsDataURL(file);
    }
  };

  const businessCategories = [
    { value: 'screenRelax', label: 'Screen & Relax', description: 'Movies, theaters, comedy shows' },
    { value: 'sipChill', label: 'Sip & Chill', description: 'Bars, cafés, wine bars, lounges' },
    { value: 'diningExp', label: 'Dining Experiences', description: 'Upscale or chef-led restaurants' },
    { value: 'casualEats', label: 'Casual Eats', description: 'Casual restaurants, diners, food trucks' },
    { value: 'creative', label: 'Creative & Hands-On', description: 'Classes, workshops, arts & crafts' },
    { value: 'wellness', label: 'Wellness Dates', description: 'Yoga, spas, sound baths, healthy dining' },
    { value: 'playMove', label: 'Play & Move', description: 'Bowling, mini golf, sports, kayaking' },
    { value: 'stroll', label: 'Take a Stroll', description: 'Parks, trails, waterfronts' },
    { value: 'picnics', label: 'Creative Picnics', description: 'Outdoor dining, scenic spots, park setups' },
    { value: 'freestyle', label: 'Freestyle', description: 'Pop-ups, festivals, unique or quirky events' }
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-gray-900">
                {editMode ? 'Edit Business' : 'Add New Business'}
              </h2>
              <p className="text-sm text-gray-600">
                Step {step} of 3
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5 text-gray-600" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="px-6 py-3 bg-gray-50">
          <div className="flex items-center gap-2">
            <div className={`flex-1 h-1 rounded-full ${step >= 1 ? 'bg-[#eb7825]' : 'bg-gray-200'}`} />
            <div className={`flex-1 h-1 rounded-full ${step >= 2 ? 'bg-[#eb7825]' : 'bg-gray-200'}`} />
            <div className={`flex-1 h-1 rounded-full ${step >= 3 ? 'bg-[#eb7825]' : 'bg-gray-200'}`} />
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div
                key="step1"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-5"
              >
                <div>
                  <h3 className="text-gray-900 mb-1">Basic Information</h3>
                  <p className="text-sm text-gray-600">
                    Tell us about the business you're onboarding
                  </p>
                </div>

                {/* Business Name */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Business Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Sunset Wine Bar"
                    className={`w-full px-4 py-3 rounded-xl border ${
                      errors.name ? 'border-red-300' : 'border-gray-300'
                    } focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent`}
                  />
                  {errors.name && (
                    <p className="text-sm text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.name}
                    </p>
                  )}
                </div>

                {/* Logo Upload */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Business Logo
                  </label>
                  <div className="flex items-center gap-4">
                    {logoPreview ? (
                      <div className="w-20 h-20 rounded-xl overflow-hidden border border-gray-200">
                        <img 
                          src={logoPreview} 
                          alt="Logo preview" 
                          className="w-full h-full object-cover"
                        />
                      </div>
                    ) : (
                      <div className="w-20 h-20 rounded-xl bg-gray-100 flex items-center justify-center">
                        <Building2 className="w-8 h-8 text-gray-400" />
                      </div>
                    )}
                    <label className="flex-1 cursor-pointer">
                      <div className="px-4 py-3 border border-gray-300 rounded-xl hover:bg-gray-50 transition-colors flex items-center justify-center gap-2">
                        <Upload className="w-4 h-4 text-gray-600" />
                        <span className="text-sm text-gray-700">
                          {logoPreview ? 'Change Logo' : 'Upload Logo'}
                        </span>
                      </div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Business Category *
                  </label>
                  <p className="text-xs text-gray-500 mb-3">
                    Select the primary type of experience your business provides
                  </p>
                  <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto pr-2">
                    {businessCategories.map((cat) => (
                      <button
                        key={cat.value}
                        type="button"
                        onClick={() => setFormData({ ...formData, category: cat.value })}
                        className={`text-left px-4 py-3 rounded-xl border transition-all ${
                          formData.category === cat.value
                            ? 'border-[#eb7825] bg-orange-50 shadow-sm'
                            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1">
                            <p className={`font-medium mb-0.5 ${
                              formData.category === cat.value ? 'text-[#eb7825]' : 'text-gray-900'
                            }`}>
                              {cat.label}
                            </p>
                            <p className="text-xs text-gray-600">{cat.description}</p>
                          </div>
                          {formData.category === cat.value && (
                            <CheckCircle className="w-5 h-5 text-[#eb7825] flex-shrink-0" />
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                  {errors.category && (
                    <p className="text-sm text-red-600 mt-2 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.category}
                    </p>
                  )}
                </div>

                {/* Description */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Description *
                  </label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder="Describe what this business offers..."
                    rows={4}
                    className={`w-full px-4 py-3 rounded-xl border ${
                      errors.description ? 'border-red-300' : 'border-gray-300'
                    } focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent resize-none`}
                  />
                  {errors.description && (
                    <p className="text-sm text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.description}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">
                    {formData.description.length}/500 characters
                  </p>
                </div>

                {/* Location */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Location
                  </label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="e.g., San Francisco, CA"
                    className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
                  />
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-5"
              >
                <div>
                  <h3 className="text-gray-900 mb-1">Commission & Contact</h3>
                  <p className="text-sm text-gray-600">
                    Set your commission rate and add contact details
                  </p>
                </div>

                {/* Commission Settings */}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Your Commission Rate *
                    </label>
                    <p className="text-xs text-gray-500 mb-3">
                      The business owner must approve this rate before you can create experiences
                    </p>
                    <div className="flex items-center gap-4">
                      <input
                        type="range"
                        min="0"
                        max="50"
                        step="1"
                        value={formData.curatorCommission}
                        onChange={(e) => setFormData({ ...formData, curatorCommission: Number(e.target.value) })}
                        className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#eb7825]"
                      />
                      <div className="w-20 text-center">
                        <span className="text-2xl font-bold text-[#eb7825]">{formData.curatorCommission}%</span>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-orange-50 to-amber-50 rounded-xl p-4 border border-orange-200">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="w-5 h-5 text-[#eb7825] flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <h4 className="text-sm font-medium text-gray-900 mb-2">
                          Revenue Split on $100 Sale
                        </h4>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Mingla Platform Fee ({platformCommission}%)</span>
                            <span className="font-medium text-gray-900">${platformCommission.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-gray-600">Your Commission ({formData.curatorCommission}%)</span>
                            <span className="font-medium text-[#eb7825]">${formData.curatorCommission.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-sm pt-1.5 border-t border-orange-200">
                            <span className="text-gray-600">Business Receives</span>
                            <span className="font-bold text-gray-900">${(100 - platformCommission - formData.curatorCommission).toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Website */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Website
                  </label>
                  <div className="relative">
                    <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="url"
                      value={formData.website}
                      onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                      placeholder="https://example.com"
                      className={`w-full pl-11 pr-4 py-3 rounded-xl border ${
                        errors.website ? 'border-red-300' : 'border-gray-300'
                      } focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent`}
                    />
                  </div>
                  {errors.website && (
                    <p className="text-sm text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.website}
                    </p>
                  )}
                </div>

                {/* Contact Email */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Contact Email
                  </label>
                  <input
                    type="email"
                    value={formData.contactEmail}
                    onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                    placeholder="contact@example.com"
                    className={`w-full px-4 py-3 rounded-xl border ${
                      errors.contactEmail ? 'border-red-300' : 'border-gray-300'
                    } focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent`}
                  />
                  {errors.contactEmail && (
                    <p className="text-sm text-red-600 mt-1 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" />
                      {errors.contactEmail}
                    </p>
                  )}
                </div>

                {/* Contact Phone */}
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Contact Phone
                  </label>
                  <input
                    type="tel"
                    value={formData.contactPhone}
                    onChange={(e) => setFormData({ ...formData, contactPhone: e.target.value })}
                    placeholder="+1 (555) 123-4567"
                    className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
                  />
                </div>
              </motion.div>
            )}

            {step === 3 && (
              <motion.div
                key="step3"
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -20 }}
                className="space-y-5"
              >
                <div>
                  <h3 className="text-gray-900 mb-1">Invite Business Users</h3>
                  <p className="text-sm text-gray-600">
                    Invite at least one business owner or manager to accept the collaboration
                  </p>
                </div>

                {/* Info Box */}
                <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-sm font-medium text-blue-900 mb-1">
                        Approval Required
                      </h4>
                      <p className="text-sm text-blue-700">
                        Invited users must accept the invitation and approve your {formData.curatorCommission}% commission rate before you can create experiences for this business.
                      </p>
                    </div>
                  </div>
                </div>

                {/* Add User Form */}
                <div className="space-y-3 p-4 bg-gray-50 rounded-xl border border-gray-200">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      User Name *
                    </label>
                    <input
                      type="text"
                      value={newUserName}
                      onChange={(e) => setNewUserName(e.target.value)}
                      placeholder="e.g., John Smith"
                      className="w-full px-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
                      onKeyPress={(e) => e.key === 'Enter' && handleAddUser()}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Email Address *
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                      <input
                        type="email"
                        value={newUserEmail}
                        onChange={(e) => setNewUserEmail(e.target.value)}
                        placeholder="john@business.com"
                        className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#eb7825] focus:border-transparent"
                        onKeyPress={(e) => e.key === 'Enter' && handleAddUser()}
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddUser}
                    className="w-full px-4 py-3 bg-[#eb7825] hover:bg-[#d6691f] text-white rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <UserPlus className="w-4 h-4" />
                    Add User
                  </button>
                </div>

                {/* Invited Users List */}
                {formData.invitedUsers.length > 0 && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">
                      Invited Users ({formData.invitedUsers.length})
                    </label>
                    <div className="space-y-2">
                      {formData.invitedUsers.map((user) => (
                        <div
                          key={user.email}
                          className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-xl"
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center">
                              <span className="text-green-700 font-medium">
                                {user.name.charAt(0).toUpperCase()}
                              </span>
                            </div>
                            <div>
                              <p className="text-gray-900 text-sm font-medium">{user.name}</p>
                              <p className="text-gray-600 text-xs">{user.email}</p>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleRemoveUser(user.email)}
                            className="p-2 text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Error Message */}
                {errors.invitedUsers && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl">
                    <p className="text-sm text-red-700 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      {errors.invitedUsers}
                    </p>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-between">
          {step === 1 ? (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleNext}
                className="px-6 py-2 bg-[#eb7825] hover:bg-[#d6691f] text-white rounded-xl transition-colors"
              >
                Next
              </button>
            </>
          ) : step === 2 ? (
            <>
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleNext}
                className="px-6 py-2 bg-[#eb7825] hover:bg-[#d6691f] text-white rounded-xl transition-colors"
              >
                Next
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setStep(2)}
                className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-xl transition-colors"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={formData.invitedUsers.length === 0}
                className="px-6 py-2 bg-[#eb7825] hover:bg-[#d6691f] text-white rounded-xl transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <CheckCircle className="w-4 h-4" />
                {editMode ? 'Save Changes' : 'Send Invitations'}
              </button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
}
