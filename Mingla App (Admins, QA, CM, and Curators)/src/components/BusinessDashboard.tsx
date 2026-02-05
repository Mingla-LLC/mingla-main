import React, { useState, useMemo } from 'react';
import { 
  Menu, X, LogOut, QrCode, Package, TrendingUp, 
  CreditCard, LineChart, Settings, HelpCircle, Home, Plus, User
} from 'lucide-react';
import { Button } from './ui/button';
import { motion, AnimatePresence } from 'motion/react';
import MinglaLogo from './MinglaLogo';
import CardCreatorModal from './CardCreatorModal';
import CardPreviewModal from './CardPreviewModal';
import QRCodeValidationModal from './QRCodeValidationModal';
import SupportTicketModal from './SupportTicketModal';
import LiveChatSupport from './LiveChatSupport';
import { getPlatformCommission } from './utils/platformSettings';
import { toast } from 'sonner@2.0.3';

// Import new business components
import BusinessOverview from './business/BusinessOverview';
import BusinessMyCards from './business/BusinessMyCards';
import BusinessSales from './business/BusinessSales';
import BusinessPayouts from './business/BusinessPayouts';
import BusinessAnalytics from './business/BusinessAnalytics';
import BusinessSupport from './business/BusinessSupport';
import BusinessSettings from './business/BusinessSettings';

interface BusinessDashboardProps {
  onSignOut: () => void;
  businessData?: {
    name: string;
    organization?: string;
    email: string;
  };
  businessCards?: any[];
  onUpdateBusinessCards?: (cards: any[]) => void;
  accountPreferences?: any;
  business?: any;
  allExperiences?: any[];
  onUpdateBusiness?: (business: any) => void;
}

export default function BusinessDashboard({ 
  onSignOut, 
  businessData, 
  businessCards: propBusinessCards, 
  onUpdateBusinessCards,
  accountPreferences,
  business,
  allExperiences = []
}: BusinessDashboardProps) {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<any>(null);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showQRValidator, setShowQRValidator] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activePage, setActivePage] = useState<'overview' | 'experiences' | 'sales' | 'payouts' | 'analytics' | 'support' | 'settings'>('experiences');
  const [showSupportTicketModal, setShowSupportTicketModal] = useState(false);
  const [showLiveChat, setShowLiveChat] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  // Get current user for creator badge
  const currentUser = JSON.parse(localStorage.getItem('currentUser') || '{}');
  const currentUserId = currentUser.id || currentUser.username || businessData?.email || '';

  // Get business experiences
  const businessExperiences = useMemo(() => {
    const allCards = JSON.parse(localStorage.getItem('platformCards') || '[]');
    return allCards.filter((card: any) => 
      card.businessId === business?.id || card.createdBy === businessData?.email
    );
  }, [business?.id, businessData?.email, refreshKey]);

  // Get purchases for this business
  const businessPurchases = useMemo(() => {
    const allPurchases = JSON.parse(localStorage.getItem('purchases') || '[]');
    return allPurchases.filter((purchase: any) => purchase.businessId === business?.id);
  }, [business?.id]);

  // Calculate financial metrics
  const metrics = useMemo(() => {
    const platformCommissionRate = getPlatformCommission();
    const totalRevenue = businessPurchases.reduce((sum, p) => sum + p.amount, 0);
    const platformFees = totalRevenue * (platformCommissionRate / 100);
    const curatorCommissions = businessPurchases.reduce((sum, p) => sum + (p.curatorCommission || 0), 0);
    const netRevenue = totalRevenue - platformFees - curatorCommissions;
    const redeemedCount = businessPurchases.filter(p => p.redeemed).length;
    const pendingCount = businessPurchases.filter(p => !p.redeemed).length;

    return {
      totalRevenue,
      platformFees,
      platformCommissionRate,
      curatorCommissions,
      netRevenue,
      redeemedCount,
      pendingCount,
      totalPurchases: businessPurchases.length
    };
  }, [businessPurchases]);

  const handleEditCard = (card: any) => {
    setSelectedCard(card);
    setShowEditModal(true);
  };

  const handleViewCard = (card: any) => {
    setSelectedCard(card);
    setShowPreviewModal(true);
  };

  const handleSaveCard = (updatedCardData: any) => {
    const cards = JSON.parse(localStorage.getItem('platformCards') || '[]');
    const existingIndex = cards.findIndex((c: any) => c.id === updatedCardData.id);
    
    // Transform the card data to match the party/festival structure if needed
    const updatedCard = {
      ...updatedCardData,
      businessId: business?.id,
      businessName: business?.name,
      createdByRole: 'business',
      // Add explorer-view specific fields for parties/festivals
      ...(updatedCardData.types?.includes('Parties') || updatedCardData.types?.includes('Festivals')) && {
        // Extract price from first package
        price: updatedCardData.purchaseOptions?.[0]?.price || 0,
        priceRange: updatedCardData.purchaseOptions?.[0]?.price ? `$${updatedCardData.purchaseOptions[0].price}` : '$0',
        // Use venue info
        venue: updatedCardData.venueName || 'TBD',
        address: `${updatedCardData.venueAddress || ''}, ${updatedCardData.venueCity || ''}, ${updatedCardData.venueState || ''} ${updatedCardData.venueZipCode || ''}`.trim() || 'Address TBD',
        // Set default party-specific fields
        host: business?.name || 'Business',
        date: 'TBD',
        time: 'TBD',
        attendees: 0,
        maxCapacity: 100,
        matchScore: 85,
        rating: 5.0,
        reviewCount: 0,
        distance: '0 km',
        travelTime: '0 min',
        image: updatedCardData.heroImage || updatedCardData.coverImage || updatedCardData.imageGallery?.[0] || 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800',
        images: updatedCardData.imageGallery || [updatedCardData.heroImage || 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800'],
        coverImage: updatedCardData.heroImage || updatedCardData.imageGallery?.[0] || 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800',
        fullDescription: updatedCardData.description || '',
        dressCode: 'Casual',
        vibe: updatedCardData.vibeTags || ['Fun', 'Social'],
        includes: updatedCardData.purchaseOptions?.map((opt: any) => opt.title) || [],
        ageGroup: '21+',
        musicGenre: updatedCardData.musicGenres?.[0] || 'Various',
        categoryIcon: 'PartyPopper'
      }
    };

    if (existingIndex >= 0) {
      cards[existingIndex] = updatedCard;
    } else {
      cards.push(updatedCard);
    }
    
    localStorage.setItem('platformCards', JSON.stringify(cards));
    window.dispatchEvent(new Event('storage'));
    setShowCreateModal(false);
    setShowEditModal(false);
    setRefreshKey(prev => prev + 1); // Trigger refresh
    toast.success('Experience saved successfully!');
  };

  const handleDeleteExperience = (cardId: string) => {
    if (confirm('Are you sure you want to delete this experience?')) {
      const cards = JSON.parse(localStorage.getItem('platformCards') || '[]');
      const filtered = cards.filter((c: any) => c.id !== cardId);
      localStorage.setItem('platformCards', JSON.stringify(filtered));
      window.dispatchEvent(new Event('storage'));
      toast.success('Experience deleted');
    }
  };

  const formatCurrency = (amount: number) => {
    const currency = accountPreferences?.currency || 'USD';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const stats = {
    totalExperiences: businessExperiences.length,
    liveExperiences: businessExperiences.filter(c => c.status === 'live').length,
    inReview: businessExperiences.filter(c => c.status === 'in-review').length,
    drafts: businessExperiences.filter(c => c.status === 'draft').length,
    totalPurchases: metrics.totalPurchases,
    redeemedCount: metrics.redeemedCount,
    pendingCount: metrics.pendingCount,
  };

  // Navigation items in the correct order
  const navigationItems = [
    { id: 'overview', label: 'Overview', icon: Home },
    { id: 'experiences', label: 'My Cards', icon: Package },
    { id: 'sales', label: 'Sales', icon: TrendingUp },
    { id: 'payouts', label: 'Payouts', icon: CreditCard },
    { id: 'analytics', label: 'Analytics', icon: LineChart },
    { id: 'support', label: 'Support', icon: HelpCircle },
    { id: 'settings', label: 'Settings', icon: Settings },
  ];

  const renderContent = () => {
    switch (activePage) {
      case 'overview':
        return (
          <BusinessOverview
            businessData={businessData}
            onNavigate={(page) => setActivePage(page as any)}
            onOpenCreateCard={() => setShowCreateModal(true)}
            onOpenQRValidator={() => setShowQRValidator(true)}
            stats={stats}
            metrics={metrics}
            formatCurrency={formatCurrency}
          />
        );

      case 'experiences':
        return (
          <BusinessMyCards
            businessData={businessData}
            experiences={businessExperiences}
            onEditCard={handleEditCard}
            onViewCard={handleViewCard}
            onDeleteCard={handleDeleteExperience}
            onCreateCard={() => setShowCreateModal(true)}
            currentUserId={currentUserId}
          />
        );

      case 'sales':
        return (
          <BusinessSales
            purchases={businessPurchases}
            formatCurrency={formatCurrency}
          />
        );

      case 'payouts':
        return <BusinessPayouts businessData={businessData} business={business} />;

      case 'analytics':
        return (
          <BusinessAnalytics
            experiences={businessExperiences}
            purchases={businessPurchases}
            formatCurrency={formatCurrency}
          />
        );

      case 'support':
        return (
          <BusinessSupport
            onOpenLiveChat={() => setShowLiveChat(true)}
            onOpenTicket={() => setShowSupportTicketModal(true)}
          />
        );

      case 'settings':
        return (
          <BusinessSettings
            businessData={businessData}
            onSignOut={onSignOut}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="h-screen bg-gradient-to-br from-gray-50 via-white to-orange-50 flex overflow-hidden">
      {/* Desktop Sidebar */}
      <div className="hidden lg:flex lg:flex-col lg:w-72 bg-white border-r border-gray-200 shadow-xl">
        {/* Sidebar Header */}
        <div className="p-6 border-b border-gray-100">
          <div className="flex flex-col items-start mb-6">
            <MinglaLogo size="lg" />
          </div>
          
          {/* Profile */}
          <div className="bg-gradient-to-br from-gray-50 to-orange-50 rounded-xl p-4 border border-gray-100">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-full flex items-center justify-center">
                <span className="text-white">{businessData?.name?.charAt(0) || business?.name?.charAt(0) || 'B'}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-gray-900 text-sm truncate">{businessData?.name || business?.name || 'Business'}</p>
                <p className="text-gray-500 text-xs truncate">{businessData?.organization || business?.category || 'Business Owner'}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar Navigation */}
        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => setActivePage(item.id as any)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                  activePage === item.id
                    ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white shadow-lg'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-5 h-5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Quick Validate Button in Sidebar */}
        <div className="p-4 border-t border-gray-100">
          <Button
            onClick={() => setShowQRValidator(true)}
            className="w-full bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white rounded-xl mb-2"
          >
            <QrCode className="w-5 h-5 mr-2" />
            Quick Validate
          </Button>
          <Button
            onClick={onSignOut}
            variant="outline"
            className="w-full justify-start gap-3 text-gray-600 hover:text-[#eb7825] hover:border-[#eb7825] rounded-xl"
          >
            <LogOut className="w-5 h-5" />
            Sign Out
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header */}
        <div className="lg:hidden bg-white border-b border-gray-200 px-3 py-2 shadow-sm">
          <div className="flex items-center justify-between">
            <MinglaLogo size="md" />
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 text-gray-600 hover:text-[#eb7825] transition-colors"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="lg:hidden bg-white border-b border-gray-200 overflow-hidden"
            >
              <div className="px-4 py-4 space-y-2">
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        setActivePage(item.id as any);
                        setMobileMenuOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all ${
                        activePage === item.id
                          ? 'bg-gradient-to-r from-[#eb7825] to-[#d6691f] text-white'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <Icon className="w-5 h-5" />
                      <span>{item.label}</span>
                    </button>
                  );
                })}
                
                <div className="my-2 border-t border-gray-200"></div>
                
                <button
                  onClick={() => {
                    setShowQRValidator(true);
                    setMobileMenuOpen(false);
                  }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-green-600 hover:bg-green-700 text-white transition-all"
                >
                  <QrCode className="w-5 h-5" />
                  <span>Quick Validate</span>
                </button>
                <button
                  onClick={onSignOut}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-gray-600 hover:bg-red-50 hover:text-red-600 transition-all"
                >
                  <LogOut className="w-5 h-5" />
                  <span>Sign Out</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto pb-12 lg:pb-0">
          <div className="p-1 sm:p-2 h-full">
            {renderContent()}
          </div>
        </div>

        {/* Mobile Bottom Navigation - Business User */}
        <motion.nav 
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="lg:hidden fixed bottom-0 left-0 right-0 z-50"
        >
          <div className="bg-white/80 backdrop-blur-xl border-t border-gray-200 shadow-2xl">
            <div className="flex items-center justify-around px-1 py-1">
              {/* Cards (Home) */}
              <button
                onClick={() => setActivePage('experiences')}
                className="flex flex-col items-center gap-1 px-4 py-2 transition-all"
              >
                <div className={`p-2 rounded-xl transition-all ${
                  activePage === 'experiences' 
                    ? 'bg-gradient-to-br from-[#eb7825] to-[#d6691f] shadow-lg' 
                    : 'bg-gray-100'
                }`}>
                  <Package className={`w-5 h-5 ${
                    activePage === 'experiences' ? 'text-white' : 'text-gray-600'
                  }`} />
                </div>
                <span className={`text-xs font-medium ${
                  activePage === 'experiences' ? 'text-[#eb7825]' : 'text-gray-600'
                }`}>
                  Cards
                </span>
              </button>

              {/* Analytics */}
              <button
                onClick={() => setActivePage('analytics')}
                className="flex flex-col items-center gap-1 px-4 py-2 transition-all"
              >
                <div className={`p-2 rounded-xl transition-all ${
                  activePage === 'analytics' 
                    ? 'bg-gradient-to-br from-[#eb7825] to-[#d6691f] shadow-lg' 
                    : 'bg-gray-100'
                }`}>
                  <LineChart className={`w-5 h-5 ${
                    activePage === 'analytics' ? 'text-white' : 'text-gray-600'
                  }`} />
                </div>
                <span className={`text-xs font-medium ${
                  activePage === 'analytics' ? 'text-[#eb7825]' : 'text-gray-600'
                }`}>
                  Analytics
                </span>
              </button>

              {/* Create (Center Plus Button) */}
              <motion.button
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setShowCreateModal(true)}
                className="relative -mt-6"
              >
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] shadow-2xl flex items-center justify-center border-4 border-white">
                  <Plus className="w-8 h-8 text-white" strokeWidth={2.5} />
                </div>
                <span className="absolute -bottom-5 left-1/2 -translate-x-1/2 text-xs font-semibold text-[#eb7825] whitespace-nowrap">
                  Create
                </span>
              </motion.button>

              {/* Finance */}
              <button
                onClick={() => setActivePage('payouts')}
                className="flex flex-col items-center gap-1 px-4 py-2 transition-all"
              >
                <div className={`p-2 rounded-xl transition-all ${
                  activePage === 'payouts' 
                    ? 'bg-gradient-to-br from-[#eb7825] to-[#d6691f] shadow-lg' 
                    : 'bg-gray-100'
                }`}>
                  <CreditCard className={`w-5 h-5 ${
                    activePage === 'payouts' ? 'text-white' : 'text-gray-600'
                  }`} />
                </div>
                <span className={`text-xs font-medium ${
                  activePage === 'payouts' ? 'text-[#eb7825]' : 'text-gray-600'
                }`}>
                  Finance
                </span>
              </button>

              {/* Profile */}
              <button
                onClick={() => setActivePage('settings')}
                className="flex flex-col items-center gap-1 px-4 py-2 transition-all"
              >
                <div className={`p-2 rounded-xl transition-all ${
                  activePage === 'settings' 
                    ? 'bg-gradient-to-br from-[#eb7825] to-[#d6691f] shadow-lg' 
                    : 'bg-gray-100'
                }`}>
                  <User className={`w-5 h-5 ${
                    activePage === 'settings' ? 'text-white' : 'text-gray-600'
                  }`} />
                </div>
                <span className={`text-xs font-medium ${
                  activePage === 'settings' ? 'text-[#eb7825]' : 'text-gray-600'
                }`}>
                  Profile
                </span>
              </button>
            </div>
          </div>
        </motion.nav>
      </div>

      {/* Modals */}
      {showCreateModal && (
        <CardCreatorModal
          isOpen={showCreateModal}
          onClose={() => setShowCreateModal(false)}
          onSave={handleSaveCard}
          userRole="business"
          createdBy={businessData?.email}
          businessId={business?.id}
          businessName={business?.name}
        />
      )}

      {showEditModal && selectedCard && (
        <CardCreatorModal
          isOpen={showEditModal}
          onClose={() => {
            setShowEditModal(false);
            setSelectedCard(null);
          }}
          onSave={handleSaveCard}
          existingCard={selectedCard}
          userRole="business"
          createdBy={businessData?.email}
          businessId={business?.id}
          businessName={business?.name}
        />
      )}

      {showPreviewModal && selectedCard && (
        <CardPreviewModal
          isOpen={showPreviewModal}
          onClose={() => {
            setShowPreviewModal(false);
            setSelectedCard(null);
          }}
          card={selectedCard}
        />
      )}

      {showQRValidator && (
        <QRCodeValidationModal
          isOpen={showQRValidator}
          onClose={() => setShowQRValidator(false)}
          businessId={business?.id}
        />
      )}

      {showSupportTicketModal && (
        <SupportTicketModal
          isOpen={showSupportTicketModal}
          onClose={() => setShowSupportTicketModal(false)}
          userRole="business"
        />
      )}

      {showLiveChat && (
        <LiveChatSupport
          isOpen={showLiveChat}
          onClose={() => setShowLiveChat(false)}
          userRole="business"
        />
      )}
    </div>
  );
}