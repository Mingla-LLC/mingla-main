import React, { useState, useEffect } from 'react';
import { 
  Plus, Building2, Eye, Edit, TrendingUp, DollarSign, 
  Package, ExternalLink, MoreVertical, Trash2, Calendar,
  Users, ArrowUpRight, AlertCircle
} from 'lucide-react';
import { motion } from 'motion/react';
import { getCategoryLabel } from './utils/formatters';
import BusinessManagementModal from './BusinessManagementModal';
import { getPlatformCommission } from './utils/platformSettings';

interface MyBusinessesSectionProps {
  businesses: any[];
  onCreateBusiness: () => void;
  onEditBusiness: (business: any) => void;
  onViewBusiness: (business: any) => void;
  onDeleteBusiness: (businessId: string) => void;
  accountPreferences?: any;
  allExperiences?: any[];
}

export default function MyBusinessesSection({
  businesses,
  onCreateBusiness,
  onEditBusiness,
  onViewBusiness,
  onDeleteBusiness,
  accountPreferences,
  allExperiences = []
}: MyBusinessesSectionProps) {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [selectedBusiness, setSelectedBusiness] = useState<any>(null);
  const [showManagementModal, setShowManagementModal] = useState(false);
  const [platformCommission, setPlatformCommission] = useState(getPlatformCommission());

  // Listen for platform commission changes
  useEffect(() => {
    const handleStorageChange = () => {
      setPlatformCommission(getPlatformCommission());
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const formatCurrency = (amount: number) => {
    const currency = accountPreferences?.currency || 'USD';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const getBusinessMetrics = (business: any) => {
    // Get experiences for this business
    const businessExps = allExperiences.filter(exp => exp.businessId === business.id);
    
    // Get actual purchases from localStorage for accurate sales data
    const allPurchases = JSON.parse(localStorage.getItem('purchases') || '[]');
    const businessPurchases = allPurchases.filter((p: any) => p.businessId === business.id);
    const totalSales = businessPurchases.reduce((sum: number, p: any) => sum + (p.amount || 0), 0);
    
    const curatorCommissionRate = business.curatorCommission || 10;
    const curatorEarnings = totalSales * (curatorCommissionRate / 100);
    
    return {
      totalExperiences: businessExps.length,
      liveExperiences: businessExps.filter(exp => exp.status === 'live').length,
      totalSales,
      curatorEarnings,
      curatorCommissionRate,
      totalPurchases: businessPurchases.length
    };
  };

  return (
    <div className="space-y-4">
      {/* Quick Stats Summary */}
      {businesses.length > 0 && (
        <div className="bg-white rounded-xl p-4 sm:p-6 border border-gray-200 hover:shadow-md transition-shadow">
          <h3 className="text-gray-900 mb-3 sm:mb-4">Your Business Portfolio Summary</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6">
            <div className="flex items-start gap-3 sm:block">
              <div className="p-2 bg-gray-50 rounded-lg sm:hidden flex-shrink-0">
                <Building2 className="w-5 h-5 text-gray-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="hidden sm:flex items-center gap-2 mb-2">
                  <Building2 className="w-5 h-5 text-gray-600" />
                  <span className="text-sm text-gray-600">Total Businesses</span>
                </div>
                <span className="text-sm text-gray-600 sm:hidden block mb-1">Total Businesses</span>
                <p className="text-2xl text-gray-900">{businesses.length}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 sm:block">
              <div className="p-2 bg-gray-50 rounded-lg sm:hidden flex-shrink-0">
                <Package className="w-5 h-5 text-gray-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="hidden sm:flex items-center gap-2 mb-2">
                  <Package className="w-5 h-5 text-gray-600" />
                  <span className="text-sm text-gray-600">Total Experiences</span>
                </div>
                <span className="text-sm text-gray-600 sm:hidden block mb-1">Total Experiences</span>
                <p className="text-2xl text-gray-900">
                  {businesses.reduce((sum, b) => {
                    return sum + getBusinessMetrics(b).totalExperiences;
                  }, 0)}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 sm:block">
              <div className="p-2 bg-green-50 rounded-lg sm:hidden flex-shrink-0">
                <TrendingUp className="w-5 h-5 text-green-600" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="hidden sm:flex items-center gap-2 mb-2">
                  <TrendingUp className="w-5 h-5 text-green-600" />
                  <span className="text-sm text-gray-600">Total Commission</span>
                </div>
                <span className="text-sm text-gray-600 sm:hidden block mb-1">Total Commission</span>
                <p className="text-2xl text-green-900">
                  {formatCurrency(
                    businesses.reduce((sum, b) => {
                      return sum + getBusinessMetrics(b).curatorEarnings;
                    }, 0)
                  )}
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Commission Info Banner */}
      <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
            <DollarSign className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <h3 className="font-medium text-green-900 mb-1">Curator Commission Program</h3>
            <p className="text-sm text-green-700 mb-2">
              You set your own commission rate on sales from businesses you manage. 
              Mingla takes <strong>{platformCommission}%</strong> platform fee, and the business receives the remainder.
            </p>
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-green-600 font-medium">
                  {formatCurrency(
                    businesses.reduce((sum, b) => {
                      return sum + getBusinessMetrics(b).curatorEarnings;
                    }, 0)
                  )}
                </span>
                <span className="text-green-700">Total Commission Earned</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Businesses Grid */}
      {businesses.length === 0 ? (
        <div className="bg-white rounded-xl p-12 border border-gray-200 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Building2 className="w-8 h-8 text-gray-400" />
          </div>
          <h3 className="text-gray-900 mb-2">No Businesses Yet</h3>
          <p className="text-sm text-gray-600 mb-6 max-w-md mx-auto">
            Onboard your first business partner to start creating experiences for them 
            and earning commission on sales
          </p>
          <button
            onClick={onCreateBusiness}
            className="px-6 py-3 bg-[#eb7825] hover:bg-[#d6691f] text-white rounded-xl transition-colors"
          >
            Add Your First Business
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {businesses.map((business) => {
            const metrics = getBusinessMetrics(business);
            
            return (
              <motion.div
                key={business.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-xl p-5 border border-gray-200 hover:border-[#eb7825] transition-all group"
              >
                {/* Business Header */}
                <div className="flex items-start gap-3 mb-4">
                  {/* Logo */}
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center flex-shrink-0 overflow-hidden">
                    {business.logo ? (
                      <img 
                        src={business.logo} 
                        alt={business.name} 
                        className="w-full h-full object-cover" 
                      />
                    ) : (
                      <span className="text-white font-bold">
                        {business.name.charAt(0)}
                      </span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-gray-900 truncate mb-1">
                      {business.name}
                    </h3>
                    {business.category && (
                      <p className="text-xs text-[#eb7825] mb-1">
                        {getCategoryLabel(business.category)}
                      </p>
                    )}
                    <p className="text-sm text-gray-600 line-clamp-1">
                      {business.description}
                    </p>
                  </div>

                  {/* Menu */}
                  <div className="relative">
                    <button
                      onClick={() => setActiveMenu(activeMenu === business.id ? null : business.id)}
                      className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"
                    >
                      <MoreVertical className="w-4 h-4 text-gray-600" />
                    </button>
                    
                    {activeMenu === business.id && (
                      <>
                        <div 
                          className="fixed inset-0 z-10" 
                          onClick={() => setActiveMenu(null)}
                        />
                        <div className="absolute right-0 top-10 w-48 bg-white rounded-xl shadow-lg border border-gray-200 py-1 z-20">
                          <button
                            onClick={() => {
                              setSelectedBusiness(business);
                              setShowManagementModal(true);
                              setActiveMenu(null);
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                          >
                            <Users className="w-4 h-4" />
                            Manage Business
                          </button>
                          <button
                            onClick={() => {
                              onDeleteBusiness(business.id);
                              setActiveMenu(null);
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                          >
                            <Trash2 className="w-4 h-4" />
                            Remove Business
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Website Link */}
                {business.website && (
                  <a
                    href={business.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-[#eb7825] hover:underline flex items-center gap-1 mb-4"
                  >
                    {business.website}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}

                {/* Commission Status */}
                <div className="mb-4">
                  <div className={`px-3 py-2 rounded-lg flex items-center justify-between ${
                    business.commissionStatus === 'approved' 
                      ? 'bg-green-50 border border-green-200' 
                      : business.commissionStatus === 'declined'
                      ? 'bg-red-50 border border-red-200'
                      : 'bg-yellow-50 border border-yellow-200'
                  }`}>
                    <div className="flex items-center gap-2">
                      {business.commissionStatus === 'approved' ? (
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                      ) : business.commissionStatus === 'declined' ? (
                        <AlertCircle className="w-4 h-4 text-red-600" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-yellow-600" />
                      )}
                      <span className={`text-xs font-medium ${
                        business.commissionStatus === 'approved' 
                          ? 'text-green-700' 
                          : business.commissionStatus === 'declined'
                          ? 'text-red-700'
                          : 'text-yellow-700'
                      }`}>
                        Commission: {metrics.curatorCommissionRate}%
                        {business.commissionStatus === 'approved' && ' (Approved)'}
                        {business.commissionStatus === 'declined' && ' (Declined)'}
                        {(!business.commissionStatus || business.commissionStatus === 'pending') && ' (Pending Approval)'}
                      </span>
                    </div>
                    {business.commissionStatus === 'approved' && (
                      <span className="text-xs text-green-600">
                        Can create experiences
                      </span>
                    )}
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-gray-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Package className="w-4 h-4 text-gray-600" />
                      <span className="text-xs text-gray-600">Experiences</span>
                    </div>
                    <p className="font-medium text-gray-900">
                      {metrics.liveExperiences}/{metrics.totalExperiences}
                      <span className="text-xs text-gray-600 ml-1">live</span>
                    </p>
                  </div>

                  <div className="bg-blue-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <TrendingUp className="w-4 h-4 text-blue-600" />
                      <span className="text-xs text-blue-600">Sales</span>
                    </div>
                    <p className="font-medium text-blue-900">
                      {metrics.totalPurchases || 0}
                      <span className="text-xs text-blue-600 ml-1">purchases</span>
                    </p>
                  </div>

                  <div className="bg-green-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <DollarSign className="w-4 h-4 text-green-600" />
                      <span className="text-xs text-green-600">Revenue</span>
                    </div>
                    <p className="font-medium text-green-900">
                      {formatCurrency(metrics.totalSales)}
                    </p>
                  </div>

                  <div className="bg-green-50 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <DollarSign className="w-4 h-4 text-green-600" />
                      <span className="text-xs text-green-600">Your Earnings</span>
                    </div>
                    <p className="font-medium text-green-900">
                      {formatCurrency(metrics.curatorEarnings)}
                    </p>
                  </div>
                </div>



                {/* Action Buttons */}
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      setSelectedBusiness(business);
                      setShowManagementModal(true);
                    }}
                    className="flex-1 px-4 py-2 bg-[#eb7825] hover:bg-[#d6691f] text-white rounded-xl transition-colors flex items-center justify-center gap-2"
                  >
                    <Users className="w-4 h-4" />
                    Manage
                  </button>
                </div>

                {/* Created Date */}
                <div className="mt-4 pt-4 border-t border-gray-100 flex items-center gap-2 text-xs text-gray-500">
                  <Calendar className="w-3 h-3" />
                  <span>
                    Added {new Date(business.createdAt).toLocaleDateString('en-US', { 
                      month: 'short', 
                      day: 'numeric', 
                      year: 'numeric' 
                    })}
                  </span>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Business Management Modal */}
      {selectedBusiness && (
        <BusinessManagementModal
          isOpen={showManagementModal}
          onClose={() => {
            setShowManagementModal(false);
            setSelectedBusiness(null);
          }}
          business={selectedBusiness}
          currentUserId={JSON.parse(localStorage.getItem('currentUser') || '{}').id || ''}
          userRole={JSON.parse(localStorage.getItem('currentUser') || '{}').role || 'explorer'}
          preloadedExperiences={allExperiences.filter(exp => exp.businessId === selectedBusiness.id)}
        />
      )}
    </div>
  );
}
