import React, { useState, useMemo, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { 
  X, Plus, TrendingUp, DollarSign, Package, Calendar,
  QrCode, CheckCircle, Clock, ArrowUpRight, Edit,
  Eye, ExternalLink, Download, Filter, Search,
  Users, MapPin, Star, Trash2, Mail, MessageSquare, AlertCircle,
  Building2, Settings as SettingsIcon, BarChart3, Send, FileText,
  CreditCard, Bell, Shield, Percent, Calculator, ChevronDown,
  ChevronUp, Copy, Check, PlayCircle, PauseCircle, Archive,
  MoreVertical, Zap, Target, Activity, PieChart, LineChart, Menu
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './ui/tabs';
import { Badge } from './ui/badge';
import { ScrollArea } from './ui/scroll-area';
import { Skeleton } from './ui/skeleton';
import { Separator } from './ui/separator';
import { Sheet, SheetContent, SheetTitle, SheetDescription } from './ui/sheet';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Slider } from './ui/slider';
import { Switch } from './ui/switch';
import { LineChart as RechartsLine, Line, BarChart as RechartsBar, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import CardCreatorModal from './CardCreatorModal';
import CardEditorModal from './CardEditorModal';
import QRCodeValidationModal from './QRCodeValidationModal';
import BusinessInviteModal from './BusinessInviteModal';
import { getCategoryLabel } from './utils/formatters';
import { getPlatformCommission } from './utils/platformSettings';

// ============================================================================
// INTERFACES & TYPES
// ============================================================================

interface Business {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  logo?: string;
  coverImage?: string;
  description?: string;
  address?: string;
  website?: string;
  phone?: string;
  email?: string;
  curatorId?: string;
  curatorName?: string;
  createdAt: string;
  curatorCommission?: number;
  commissionStatus?: 'pending' | 'approved' | 'declined';
  status?: 'active' | 'pending' | 'suspended';
  stripeConnected?: boolean;
  paypalConnected?: boolean;
  lastPayoutDate?: string;
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

interface Payout {
  id: string;
  businessId: string;
  amount: number;
  curatorCommission?: number;
  platformFee?: number;
  status: 'pending' | 'processing' | 'completed';
  periodStart: string;
  periodEnd: string;
  purchaseCount: number;
  createdAt: string;
  paidAt?: string;
}

interface NegotiationMessage {
  id: string;
  from: 'curator' | 'business' | 'platform';
  fromName: string;
  message: string;
  proposedRate?: number;
  timestamp: string;
  status?: 'pending' | 'approved' | 'declined';
}

interface Collaborator {
  id: string;
  name: string;
  email: string;
  role: 'manager' | 'viewer'; // Only business users - NOT curators
  addedAt: string;
  status: 'active' | 'suspended' | 'invited';
}

interface BusinessManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  business: Business;
  currentUserId: string;
  userRole: string;
  preloadedExperiences?: any[];
}

// ============================================================================
// DESIGN TOKENS
// ============================================================================

const tokens = {
  spacing: {
    xs: '4px',
    sm: '8px',
    md: '16px',
    lg: '24px',
    xl: '32px',
  },
  radius: {
    sm: '8px',
    md: '12px',
    lg: '16px',
  },
  transition: {
    fast: '160ms',
    medium: '220ms',
    slow: '280ms',
  },
  breakpoints: {
    xs: 360,
    sm: 600,
    md: 900,
    lg: 1280,
  },
  colors: {
    primary: 'linear-gradient(135deg, #eb7825 0%, #d6691f 100%)',
    success: '#10b981',
    warning: '#f59e0b',
    error: '#ef4444',
  }
};

// ============================================================================
// MOCK DATA GENERATORS
// ============================================================================

const generateMockAnalyticsData = (days: number) => {
  const data = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    data.push({
      date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      revenue: Math.floor(Math.random() * 5000) + 1000,
      sales: Math.floor(Math.random() * 20) + 5,
      views: Math.floor(Math.random() * 200) + 50,
    });
  }
  return data;
};

const generateMockNegotiationHistory = (): NegotiationMessage[] => [
  {
    id: '1',
    from: 'platform',
    fromName: 'Mingla',
    message: 'Welcome! The platform fee is 15%. Curator can propose their commission rate.',
    timestamp: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  },
  {
    id: '2',
    from: 'curator',
    fromName: 'Sarah Chen',
    message: 'I propose a 12% commission rate based on my experience in this category.',
    proposedRate: 12,
    timestamp: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'pending',
  },
  {
    id: '3',
    from: 'business',
    fromName: 'Business Owner',
    message: 'Can we negotiate to 10%? That would work better for our margins.',
    proposedRate: 10,
    timestamp: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'declined',
  },
  {
    id: '4',
    from: 'curator',
    fromName: 'Sarah Chen',
    message: 'I can do 11% given the quality of experiences I create.',
    proposedRate: 11,
    timestamp: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(),
    status: 'approved',
  },
];

// ============================================================================
// SUB-COMPONENTS
// ============================================================================

const EmptyState = ({ icon: Icon, title, description, action }: any) => (
  <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
    <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mb-4">
      <Icon className="w-8 h-8 text-gray-400" />
    </div>
    <h3 className="text-gray-900 mb-2">{title}</h3>
    <p className="text-gray-500 text-sm mb-6 max-w-sm">{description}</p>
    {action}
  </div>
);

const LoadingState = () => (
  <div className="space-y-4 p-4">
    <Skeleton className="h-24 w-full" />
    <Skeleton className="h-24 w-full" />
    <Skeleton className="h-24 w-full" />
  </div>
);

const KPICard = ({ icon: Icon, label, value, delta, trend, sublabel }: any) => (
  <motion.div
    whileHover={{ scale: 1.02 }}
    className="bg-white rounded-xl p-4 border border-gray-200 hover:shadow-md transition-shadow"
  >
    <div className="flex items-start justify-between mb-2">
      <div className={`w-10 h-10 rounded-lg bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center`}>
        <Icon className="w-5 h-5 text-white" />
      </div>
      {delta && (
        <Badge variant={trend === 'up' ? 'default' : 'secondary'} className="text-xs">
          {trend === 'up' ? '↑' : '↓'} {delta}
        </Badge>
      )}
    </div>
    <div className="text-gray-600 text-sm mb-1">{label}</div>
    <div className="text-2xl text-gray-900">{value}</div>
    {sublabel && <div className="text-gray-500 text-xs mt-1">{sublabel}</div>}
  </motion.div>
);

const RoleChip = ({ role }: { role: 'curator' | 'business' | 'platform' }) => {
  const config = {
    curator: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Curator-editable' },
    business: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Business-editable' },
    platform: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Platform-set' },
  };
  const { bg, text, label } = config[role];
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded text-xs ${bg} ${text}`}>
      {label}
    </span>
  );
};

const StatusChip = ({ status }: { status: string }) => {
  const config: any = {
    draft: { bg: 'bg-gray-100', text: 'text-gray-700' },
    pending: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
    approved: { bg: 'bg-green-100', text: 'text-green-700' },
    declined: { bg: 'bg-red-100', text: 'text-red-700' },
    live: { bg: 'bg-green-100', text: 'text-green-700' },
    active: { bg: 'bg-green-100', text: 'text-green-700' },
    archived: { bg: 'bg-gray-100', text: 'text-gray-700' },
    suspended: { bg: 'bg-red-100', text: 'text-red-700' },
    redeemed: { bg: 'bg-blue-100', text: 'text-blue-700' },
    completed: { bg: 'bg-green-100', text: 'text-green-700' },
    processing: { bg: 'bg-yellow-100', text: 'text-yellow-700' },
  };
  const { bg, text } = config[status.toLowerCase()] || config.draft;
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded text-xs ${bg} ${text} capitalize`}>
      {status}
    </span>
  );
};

// ============================================================================
// PORTAL WRAPPER FOR SUB-MODALS
// ============================================================================

const ModalPortal = ({ children }: { children: React.ReactNode }) => {
  const [portalRoot] = React.useState(() => {
    if (typeof document === 'undefined') return null;
    const div = document.createElement('div');
    div.setAttribute('data-modal-portal', 'true');
    div.style.position = 'relative';
    div.style.zIndex = '9999';
    return div;
  });

  React.useEffect(() => {
    if (!portalRoot) return;
    document.body.appendChild(portalRoot);
    return () => {
      document.body.removeChild(portalRoot);
    };
  }, [portalRoot]);

  if (!portalRoot) return null;
  return ReactDOM.createPortal(children, portalRoot);
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function BusinessManagementModal({ 
  isOpen, 
  onClose, 
  business,
  currentUserId,
  userRole,
  preloadedExperiences = []
}: BusinessManagementModalProps) {
  // =========================================================================
  // STATE MANAGEMENT
  // =========================================================================
  
  const [activeTab, setActiveTab] = useState('overview');
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 600);
  const [isLoading, setIsLoading] = useState(false);
  const [viewAsRole, setViewAsRole] = useState<'curator' | 'business' | null>(null);
  const [sideMenuOpen, setSideMenuOpen] = useState(false);
  
  // Modal states
  const [showCreateCard, setShowCreateCard] = useState(false);
  const [showEditCard, setShowEditCard] = useState(false);
  const [showQRValidator, setShowQRValidator] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [selectedCard, setSelectedCard] = useState<any>(null);
  const [selectedPurchase, setSelectedPurchase] = useState<any>(null);
  
  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState('30');
  const [statusFilter, setStatusFilter] = useState('all');
  const [experienceFilter, setExperienceFilter] = useState('all');
  
  // Commission negotiation states
  const [proposedRate, setProposedRate] = useState(business.curatorCommission || 10);
  const [negotiationMessage, setNegotiationMessage] = useState('');
  const [negotiationHistory, setNegotiationHistory] = useState<NegotiationMessage[]>(() => {
    // Try to load from localStorage first
    const storageKey = `negotiation_history_${business.id}`;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      return JSON.parse(stored);
    }
    // Otherwise generate mock data
    return generateMockNegotiationHistory();
  });
  
  // Settings states
  const [editedBusiness, setEditedBusiness] = useState(business);
  const [isEditingBusiness, setIsEditingBusiness] = useState(false);
  const [collaborators, setCollaborators] = useState<Collaborator[]>([
    // Only business users who can log in to manage the business
    // Curators are NOT collaborators - they're the ones who created the business profile
  ]);
  
  // Notification preferences
  const [notifications, setNotifications] = useState({
    emailProposals: true,
    emailApprovals: true,
    emailPayouts: true,
    emailSales: true,
    pushProposals: false,
    pushApprovals: true,
    pushPayouts: true,
    pushSales: false,
  });
  
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  
  // =========================================================================
  // RESPONSIVE HANDLING
  // =========================================================================
  
  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 600);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);


  
  // =========================================================================
  // DATA FETCHING & PROCESSING
  // =========================================================================
  
  // Get business experiences
  const businessExperiences = useMemo(() => {
    const stored = localStorage.getItem('mingla_cards');
    if (!stored) return preloadedExperiences;
    
    const allCards = JSON.parse(stored);
    return allCards.filter((card: any) => card.businessId === business.id);
  }, [business.id, preloadedExperiences, refreshTrigger]);
  
  // Get business purchases
  const businessPurchases = useMemo(() => {
    const stored = localStorage.getItem('mingla_purchases');
    if (!stored) return [];
    
    const allPurchases = JSON.parse(stored);
    const experienceIds = businessExperiences.map((exp: any) => exp.id);
    return allPurchases.filter((p: Purchase) => experienceIds.includes(p.experienceId));
  }, [businessExperiences, refreshTrigger]);
  
  // Get payouts
  const payouts = useMemo(() => {
    const stored = localStorage.getItem('mingla_payouts');
    if (!stored) return [];
    
    const allPayouts: Payout[] = JSON.parse(stored);
    return allPayouts.filter((p: Payout) => p.businessId === business.id);
  }, [business.id, refreshTrigger]);
  
  // Calculate metrics
  const metrics = useMemo(() => {
    const platformCommissionRate = getPlatformCommission();
    const curatorCommissionRate = business.curatorCommission || 10;
    
    const totalRevenue = businessPurchases.reduce((sum, p) => sum + p.amount, 0);
    const totalPurchases = businessPurchases.length;
    const redeemedPurchases = businessPurchases.filter(p => p.redeemed).length;
    
    const platformFees = totalRevenue * (platformCommissionRate / 100);
    const curatorCommissions = totalRevenue * (curatorCommissionRate / 100);
    const netRevenue = totalRevenue - platformFees - curatorCommissions;
    
    const totalPaidOut = payouts
      .filter(p => p.status === 'completed')
      .reduce((sum, p) => sum + p.amount, 0);
    const pendingPayout = netRevenue - totalPaidOut;
    
    // Analytics metrics
    const avgOrderValue = totalPurchases > 0 ? totalRevenue / totalPurchases : 0;
    const conversionRate = 15.3; // Mock
    const avgRating = 4.7; // Mock
    const totalViews = 1247; // Mock
    
    return {
      totalRevenue,
      totalPurchases,
      redeemedPurchases,
      platformCommissionRate,
      curatorCommissionRate,
      platformFees,
      curatorCommissions,
      netRevenue,
      totalPaidOut,
      pendingPayout,
      avgOrderValue,
      conversionRate,
      avgRating,
      totalViews,
      experiencesLive: businessExperiences.filter((e: any) => !e.isDraft).length,
      experiencesDraft: businessExperiences.filter((e: any) => e.isDraft).length,
    };
  }, [businessPurchases, payouts, business.curatorCommission, businessExperiences]);
  
  // Analytics data
  const analyticsData = useMemo(() => {
    return generateMockAnalyticsData(parseInt(dateRange));
  }, [dateRange]);
  
  const experiencePerformanceData = useMemo(() => {
    return businessExperiences.slice(0, 5).map((exp: any) => ({
      name: exp.title.length > 20 ? exp.title.substring(0, 20) + '...' : exp.title,
      revenue: Math.floor(Math.random() * 5000) + 500,
      sales: Math.floor(Math.random() * 50) + 5,
    }));
  }, [businessExperiences]);
  
  // =========================================================================
  // EVENT HANDLERS
  // =========================================================================
  
  const handleCreateExperience = () => {
    console.log('handleCreateExperience called - opening CardCreatorModal');
    setShowCreateCard(true);
  };
  
  const handleSaveNewExperience = (cardData: any) => {
    // Save to localStorage
    const stored = localStorage.getItem('mingla_cards') || '[]';
    const cards = JSON.parse(stored);
    
    // Add business information to the card
    const newCard = {
      ...cardData,
      id: `card_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      businessId: business.id,
      businessName: business.name,
      curatorId: business.curatorId || currentUserId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    
    localStorage.setItem('mingla_cards', JSON.stringify([...cards, newCard]));
    
    // Close modal and refresh
    setShowCreateCard(false);
    setRefreshTrigger(prev => prev + 1);
  };
  
  const handleEditExperience = (card: any) => {
    setSelectedCard(card);
    setShowEditCard(true);
  };
  
  const handleDeleteExperience = (cardId: string) => {
    if (!confirm('Are you sure you want to delete this experience?')) return;
    
    const stored = localStorage.getItem('mingla_cards');
    if (!stored) return;
    
    const cards = JSON.parse(stored);
    const updated = cards.filter((c: any) => c.id !== cardId);
    localStorage.setItem('mingla_cards', JSON.stringify(updated));
    setRefreshTrigger(prev => prev + 1);
  };
  
  const handleDuplicateExperience = (card: any) => {
    const newCard = {
      ...card,
      id: `card_${Date.now()}_${Math.random().toString(36).substring(7)}`,
      title: `${card.title} (Copy)`,
      isDraft: true,
      createdAt: new Date().toISOString(),
    };
    
    const stored = localStorage.getItem('mingla_cards') || '[]';
    const cards = JSON.parse(stored);
    localStorage.setItem('mingla_cards', JSON.stringify([...cards, newCard]));
    setRefreshTrigger(prev => prev + 1);
  };
  
  const handleSendProposal = () => {
    const newMessage: NegotiationMessage = {
      id: Date.now().toString(),
      from: userRole as any,
      fromName: userRole === 'curator' ? business.curatorName || 'You' : 'You',
      message: negotiationMessage || `I propose a ${proposedRate}% commission rate.`,
      proposedRate,
      timestamp: new Date().toISOString(),
      status: 'pending',
    };
    
    const updatedHistory = [...negotiationHistory, newMessage];
    setNegotiationHistory(updatedHistory);
    setNegotiationMessage('');
    
    // Save to localStorage
    const storageKey = `negotiation_history_${business.id}`;
    localStorage.setItem(storageKey, JSON.stringify(updatedHistory));
    
    // Simulate auto-response for demo
    setTimeout(() => {
      const autoResponse: NegotiationMessage = {
        id: (Date.now() + 1).toString(),
        from: userRole === 'curator' ? 'business' : 'curator',
        fromName: userRole === 'curator' ? 'Business Owner' : business.curatorName || 'Curator',
        message: 'Thank you for the proposal. Let me review and get back to you.',
        timestamp: new Date().toISOString(),
      };
      const historyWithResponse = [...updatedHistory, autoResponse];
      setNegotiationHistory(historyWithResponse);
      localStorage.setItem(storageKey, JSON.stringify(historyWithResponse));
    }, 2000);
  };
  
  const handleApproveProposal = (messageId: string) => {
    const updatedHistory = negotiationHistory.map(msg =>
      msg.id === messageId ? { ...msg, status: 'approved' as const } : msg
    );
    setNegotiationHistory(updatedHistory);
    
    // Save to localStorage
    const storageKey = `negotiation_history_${business.id}`;
    localStorage.setItem(storageKey, JSON.stringify(updatedHistory));
    
    // Update business commission
    const message = negotiationHistory.find(m => m.id === messageId);
    if (message?.proposedRate) {
      const updatedBusiness = { ...business, curatorCommission: message.proposedRate, commissionStatus: 'approved' as const };
      setEditedBusiness(updatedBusiness);
      
      // Update in localStorage
      const businesses = JSON.parse(localStorage.getItem('mingla_businesses') || '[]');
      const updated = businesses.map((b: Business) => 
        b.id === business.id ? updatedBusiness : b
      );
      localStorage.setItem('mingla_businesses', JSON.stringify(updated));
    }
  };
  
  const handleDeclineProposal = (messageId: string) => {
    const updatedHistory = negotiationHistory.map(msg =>
      msg.id === messageId ? { ...msg, status: 'declined' as const } : msg
    );
    setNegotiationHistory(updatedHistory);
    
    // Save to localStorage
    const storageKey = `negotiation_history_${business.id}`;
    localStorage.setItem(storageKey, JSON.stringify(updatedHistory));
  };
  
  const handleUpdateBusiness = () => {
    const businesses = JSON.parse(localStorage.getItem('mingla_businesses') || '[]');
    const updated = businesses.map((b: Business) => 
      b.id === business.id ? editedBusiness : b
    );
    localStorage.setItem('mingla_businesses', JSON.stringify(updated));
    setIsEditingBusiness(false);
    setRefreshTrigger(prev => prev + 1);
  };
  
  const handleInviteCollaborator = (email: string, role: string) => {
    const newCollab: Collaborator = {
      id: Date.now().toString(),
      name: email.split('@')[0],
      email,
      role: role as any,
      addedAt: new Date().toISOString(),
      status: 'active',
    };
    setCollaborators([...collaborators, newCollab]);
  };
  
  const handleRemoveCollaborator = (id: string) => {
    if (!confirm('Remove this collaborator?')) return;
    setCollaborators(collaborators.filter(c => c.id !== id));
  };
  
  const handleToggleCollaboratorStatus = (id: string) => {
    setCollaborators(collaborators.map(c =>
      c.id === id
        ? { ...c, status: c.status === 'active' ? 'suspended' : 'active' }
        : c
    ));
  };
  
  const handleExportPayouts = (format: 'csv' | 'pdf') => {
    // Mock export
    alert(`Exporting payouts as ${format.toUpperCase()}...`);
  };
  
  // =========================================================================
  // FILTERED DATA
  // =========================================================================
  
  const filteredExperiences = useMemo(() => {
    return businessExperiences.filter((exp: any) => {
      const matchesSearch = exp.title.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' ||
        (statusFilter === 'draft' && exp.isDraft) ||
        (statusFilter === 'live' && !exp.isDraft);
      return matchesSearch && matchesStatus;
    });
  }, [businessExperiences, searchQuery, statusFilter]);
  
  const filteredSales = useMemo(() => {
    return businessPurchases.filter((purchase: Purchase) => {
      const matchesSearch = 
        purchase.experienceName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        purchase.buyerName.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' ||
        (statusFilter === 'redeemed' && purchase.redeemed) ||
        (statusFilter === 'pending' && !purchase.redeemed);
      const matchesExperience = experienceFilter === 'all' || 
        purchase.experienceId === experienceFilter;
      return matchesSearch && matchesStatus && matchesExperience;
    });
  }, [businessPurchases, searchQuery, statusFilter, experienceFilter]);
  
  // =========================================================================
  // RENDER HELPERS
  // =========================================================================
  
  const renderTabBar = () => {
    const tabs = [
      { id: 'overview', label: 'Overview', icon: BarChart3 },
      { id: 'experiences', label: 'Experiences', icon: Package },
      { id: 'sales', label: 'Sales', icon: DollarSign },
      { id: 'negotiations', label: 'Negotiations', icon: MessageSquare },
      { id: 'payouts', label: 'Payouts', icon: CreditCard },
      { id: 'analytics', label: 'Analytics', icon: LineChart },
      { id: 'settings', label: 'Settings', icon: SettingsIcon },
    ];
    
    if (isMobile) {
      // Side menu for mobile - no bottom tab bar
      return null;
    }
    
    // Top tabs for desktop
    return (
      <div className="bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex overflow-x-auto scrollbar-hide px-6 md:px-8">
          {tabs.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-4 border-b-2 transition-colors whitespace-nowrap ${
                  isActive
                    ? 'border-[#eb7825] text-[#eb7825]'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };
  
  // =========================================================================
  // TAB CONTENT RENDERERS
  // =========================================================================
  
  const renderOverviewTab = () => (
    <div className="space-y-6 md:space-y-3 p-4 md:p-6">
      {/* Quick Actions - Mobile optimized */}
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-4 px-4 md:mx-0 md:px-0 scrollbar-hide">
        <button
          onClick={handleCreateExperience}
          className="flex items-center gap-2 bg-gradient-to-br from-[#eb7825] to-[#d6691f] text-white rounded-lg px-3 py-2 md:py-1.5 hover:shadow-lg transition-all active:scale-95 whitespace-nowrap flex-shrink-0"
        >
          <Plus className="w-4 h-4" />
          <span className="text-sm">New Experience</span>
        </button>
        <button
          onClick={() => setShowQRValidator(true)}
          className="flex items-center gap-2 bg-gradient-to-br from-blue-500 to-blue-600 text-white rounded-lg px-3 py-2 md:py-1.5 hover:shadow-lg transition-all active:scale-95 whitespace-nowrap flex-shrink-0"
        >
          <QrCode className="w-4 h-4" />
          <span className="text-sm">Scan QR</span>
        </button>
        {userRole === 'curator' && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 bg-gradient-to-br from-purple-500 to-purple-600 text-white rounded-lg px-3 py-2 md:py-1.5 hover:shadow-lg transition-all active:scale-95 whitespace-nowrap flex-shrink-0"
          >
            <Mail className="w-4 h-4" />
            <span className="text-sm">Invite</span>
          </button>
        )}
        <button
          onClick={() => setActiveTab('settings')}
          className="flex items-center gap-2 bg-gradient-to-br from-gray-500 to-gray-600 text-white rounded-lg px-3 py-2 md:py-1.5 hover:shadow-lg transition-all active:scale-95 whitespace-nowrap flex-shrink-0"
        >
          <SettingsIcon className="w-4 h-4" />
          <span className="text-sm">Settings</span>
        </button>
      </div>
      
      {/* Hero Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-gradient-to-br from-[#eb7825] to-[#d6691f] rounded-xl p-6 md:p-4 text-white"
      >
        <div className="flex items-start gap-4 md:gap-3">
          <div className="w-16 h-16 md:w-12 md:h-12 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
            {business.logo ? (
              <img src={business.logo} alt={business.name} className="w-full h-full object-cover rounded-lg" />
            ) : (
              <Building2 className="w-8 h-8 md:w-6 md:h-6" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-xl md:text-lg mb-1 truncate">{business.name}</h2>
            <p className="text-white/80 text-sm mb-2 md:mb-1">{getCategoryLabel(business.category, business.subcategory)}</p>
            <StatusChip status={business.status || 'active'} />
          </div>
        </div>
      </motion.div>
      
      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPICard
          icon={DollarSign}
          label="Total Revenue"
          value={`$${metrics.totalRevenue.toLocaleString()}`}
          sublabel={`${metrics.totalPurchases} sales`}
          delta="+12%"
          trend="up"
        />
        <KPICard
          icon={TrendingUp}
          label="Net to Business"
          value={`$${Math.floor(metrics.netRevenue).toLocaleString()}`}
          sublabel="After fees"
        />
        <KPICard
          icon={Package}
          label="Experiences Live"
          value={metrics.experiencesLive}
          sublabel={`${metrics.experiencesDraft} drafts`}
        />
        <KPICard
          icon={Activity}
          label="Sales"
          value={metrics.totalPurchases}
          sublabel={`${metrics.redeemedPurchases} redeemed`}
          delta="+8%"
          trend="up"
        />
      </div>
      
      {/* Mini Trend Chart */}
      <div className="bg-white rounded-xl p-4 md:p-3 border border-gray-200">
        <div className="flex items-center justify-between mb-4 md:mb-2">
          <h3 className="text-gray-900 flex items-center gap-2">
            <TrendingUp className="w-5 h-5 md:w-4 md:h-4 text-green-600" />
            <span className="md:text-sm">Revenue Trend (Last {dateRange} Days)</span>
          </h3>
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-24 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7d</SelectItem>
              <SelectItem value="30">30d</SelectItem>
              <SelectItem value="90">90d</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <ResponsiveContainer width="100%" height={isMobile ? 150 : 140}>
          <AreaChart data={analyticsData.slice(-parseInt(dateRange))}>
            <defs>
              <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#eb7825" stopOpacity={0.3}/>
                <stop offset="95%" stopColor="#eb7825" stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <RechartsTooltip />
            <Area type="monotone" dataKey="revenue" stroke="#eb7825" fillOpacity={1} fill="url(#colorRevenue)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      
      {/* Relationship Panel */}
      <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl p-4 md:p-3 border border-purple-200">
        <h3 className="text-gray-900 mb-4 md:mb-2 flex items-center gap-2">
          <Users className="w-5 h-5 md:w-4 md:h-4 text-purple-600" />
          <span className="md:text-sm">Partnership Details</span>
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 md:gap-3">
          <div className="bg-white rounded-lg p-3 md:p-2">
            <div className="text-xs text-gray-600 mb-1 flex items-center gap-2">
              Platform Fee <RoleChip role="platform" />
            </div>
            <div className="text-xl md:text-lg text-gray-900">{metrics.platformCommissionRate}%</div>
            <div className="text-xs text-gray-500 mt-1">${metrics.platformFees.toFixed(0)} collected</div>
          </div>
          <div className="bg-white rounded-lg p-3 md:p-2">
            <div className="text-xs text-gray-600 mb-1 flex items-center gap-2">
              Curator Commission <RoleChip role="curator" />
            </div>
            <div className="text-xl md:text-lg text-green-900">{metrics.curatorCommissionRate}%</div>
            <div className="text-xs text-green-600 mt-1">
              ${metrics.curatorCommissions.toFixed(0)} earned
              {business.commissionStatus && (
                <StatusChip status={business.commissionStatus} />
              )}
            </div>
          </div>
          <div className="bg-white rounded-lg p-3 md:p-2">
            <div className="text-xs text-gray-600 mb-1">Next Payout</div>
            <div className="text-xl md:text-lg text-gray-900">
              ${metrics.pendingPayout > 0 ? metrics.pendingPayout.toFixed(0) : '0'}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {business.lastPayoutDate
                ? `Last: ${new Date(business.lastPayoutDate).toLocaleDateString()}`
                : 'No payouts yet'}
            </div>
          </div>
          <div className="bg-white rounded-lg p-3 md:p-2">
            <div className="text-xs text-gray-600 mb-1">Contract Started</div>
            <div className="text-xl md:text-lg text-gray-900">
              {new Date(business.createdAt).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {Math.floor((Date.now() - new Date(business.createdAt).getTime()) / (1000 * 60 * 60 * 24))} days active
            </div>
          </div>
        </div>
      </div>
      
      {/* Recent Activity */}
      <div>
        <h3 className="text-gray-900 mb-3 md:mb-2 flex items-center gap-2">
          <Clock className="w-5 h-5 md:w-4 md:h-4 text-gray-600" />
          <span className="md:text-sm">Recent Sales</span>
        </h3>
        {businessPurchases.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No sales yet"
            description="Create experiences to start selling and earning revenue."
            action={
              <Button onClick={handleCreateExperience} className="bg-gradient-to-br from-[#eb7825] to-[#d6691f]">
                <Plus className="w-4 h-4 mr-2" />
                Create First Experience
              </Button>
            }
          />
        ) : (
          <div className="space-y-2 md:space-y-1.5">
            {businessPurchases.slice(0, isMobile ? 5 : 3).map((purchase) => (
              <motion.div
                key={purchase.id}
                whileHover={{ scale: 1.01 }}
                className="bg-white rounded-lg p-4 md:p-3 border border-gray-200 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-900 md:text-sm truncate">{purchase.experienceName}</div>
                    <div className="text-sm md:text-xs text-gray-500 mt-1">
                      {purchase.buyerName} • {purchase.packageTitle}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {new Date(purchase.purchaseDate).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-gray-900 md:text-sm">${purchase.amount}</div>
                    <div className="mt-2 md:mt-1">
                      <StatusChip status={purchase.redeemed ? 'redeemed' : 'pending'} />
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
            {businessPurchases.length > (isMobile ? 5 : 3) && (
              <Button
                onClick={() => setActiveTab('sales')}
                variant="outline"
                className="w-full md:h-8 md:text-sm"
              >
                View All Sales ({businessPurchases.length})
                <ArrowUpRight className="w-4 h-4 md:w-3 md:h-3 ml-2" />
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
  
  const renderExperiencesTab = () => (
    <div className="space-y-4 p-4 md:p-8">
      {/* Filters & Search */}
      <div className="sticky top-0 bg-white z-10 pb-4 space-y-3">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search experiences..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
          <Button onClick={handleCreateExperience} className="bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex-shrink-0">
            <Plus className="w-4 h-4 mr-2" />
            {!isMobile && 'New'}
          </Button>
        </div>
        
        <div className="flex gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="live">Live</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {/* Experiences Grid/List */}
      {isLoading ? (
        <LoadingState />
      ) : filteredExperiences.length === 0 ? (
        <EmptyState
          icon={Package}
          title={searchQuery ? 'No experiences found' : 'No experiences yet'}
          description={searchQuery ? 'Try adjusting your search or filters.' : 'Create your first experience to start selling.'}
          action={
            !searchQuery && (
              <Button onClick={handleCreateExperience} className="bg-gradient-to-br from-[#eb7825] to-[#d6691f]">
                <Plus className="w-4 h-4 mr-2" />
                Create Experience
              </Button>
            )
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredExperiences.map((exp: any) => (
            <motion.div
              key={exp.id}
              whileHover={{ y: -4 }}
              className="bg-white rounded-xl overflow-hidden border border-gray-200 hover:shadow-lg transition-shadow"
            >
              {/* Image */}
              <div className="aspect-[16/9] bg-gradient-to-br from-[#eb7825]/10 to-[#d6691f]/10 relative">
                {exp.images?.[0] ? (
                  <img src={exp.images[0]} alt={exp.title} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Package className="w-12 h-12 text-gray-300" />
                  </div>
                )}
                <div className="absolute top-2 right-2">
                  <StatusChip status={exp.isDraft ? 'draft' : 'live'} />
                </div>
              </div>
              
              {/* Content */}
              <div className="p-4">
                <h3 className="text-gray-900 mb-2 line-clamp-2">{exp.title}</h3>
                <p className="text-sm text-gray-500 mb-3 line-clamp-2">{exp.description}</p>
                
                <div className="flex items-center justify-between text-sm mb-3">
                  <span className="text-gray-600">
                    {exp.packages?.length || 0} package{exp.packages?.length !== 1 ? 's' : ''}
                  </span>
                  {exp.packages && exp.packages.length > 0 && (
                    <span className="text-gray-900">
                      From ${Math.min(...exp.packages.map((p: any) => p.price))}
                    </span>
                  )}
                </div>
                
                {/* Actions */}
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleEditExperience(exp)}
                    variant="outline"
                    size="sm"
                    className="flex-1"
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    Edit
                  </Button>
                  <Button
                    onClick={() => handleDuplicateExperience(exp)}
                    variant="outline"
                    size="sm"
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                  <Button
                    onClick={() => handleDeleteExperience(exp.id)}
                    variant="outline"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
  
  const renderSalesTab = () => (
    <div className="space-y-4 p-4 md:p-8">
      {/* Filters */}
      <div className="sticky top-0 bg-white z-10 pb-4 space-y-3">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search sales..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
            />
          </div>
        </div>
        
        <div className="grid grid-cols-2 gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="redeemed">Redeemed</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
          
          <Select value={experienceFilter} onValueChange={setExperienceFilter}>
            <SelectTrigger>
              <SelectValue placeholder="Experience" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Experiences</SelectItem>
              {businessExperiences.slice(0, 10).map((exp: any) => (
                <SelectItem key={exp.id} value={exp.id}>
                  {exp.title.substring(0, 30)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      
      {/* Sales List */}
      {filteredSales.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          title="No sales found"
          description={searchQuery ? 'Try adjusting your search or filters.' : 'Sales will appear here when customers purchase experiences.'}
        />
      ) : (
        <div className="space-y-2">
          {filteredSales.map((purchase) => {
            const platformFee = purchase.amount * (metrics.platformCommissionRate / 100);
            const curatorFee = purchase.amount * (metrics.curatorCommissionRate / 100);
            const businessNet = purchase.amount - platformFee - curatorFee;
            
            return (
              <motion.div
                key={purchase.id}
                whileHover={{ scale: 1.01 }}
                className="bg-white rounded-lg p-4 border border-gray-200 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-900 truncate">{purchase.experienceName}</div>
                    <div className="text-sm text-gray-500 mt-1">
                      {purchase.buyerName}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">
                      {new Date(purchase.purchaseDate).toLocaleDateString()} • {purchase.packageTitle}
                    </div>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <div className="text-gray-900">${purchase.amount}</div>
                    <div className="mt-2">
                      <StatusChip status={purchase.redeemed ? 'redeemed' : 'pending'} />
                    </div>
                  </div>
                </div>
                
                {/* Commission Breakdown */}
                <div className="grid grid-cols-3 gap-2 text-xs pt-3 border-t border-gray-100">
                  <div>
                    <div className="text-gray-500">Platform</div>
                    <div className="text-gray-900">${platformFee.toFixed(2)}</div>
                  </div>
                  {userRole === 'curator' && (
                    <div>
                      <div className="text-gray-500">Curator</div>
                      <div className="text-green-900">${curatorFee.toFixed(2)}</div>
                    </div>
                  )}
                  <div>
                    <div className="text-gray-500">Business</div>
                    <div className="text-gray-900">${businessNet.toFixed(2)}</div>
                  </div>
                </div>
                
                {!purchase.redeemed && (
                  <Button
                    onClick={() => {
                      setSelectedPurchase(purchase);
                      setShowQRValidator(true);
                    }}
                    size="sm"
                    variant="outline"
                    className="w-full mt-3"
                  >
                    <QrCode className="w-4 h-4 mr-2" />
                    Validate QR Code
                  </Button>
                )}
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
  
  const renderNegotiationsTab = () => {
    // Empty state
    const hasMessages = negotiationHistory.length > 0;
    
    // Chat Section Component
    const ChatSection = () => (
      <div className="h-full flex flex-col">
        {hasMessages ? (
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {negotiationHistory.map((msg) => {
              const isFromCurrentUser = 
                (userRole === 'curator' && msg.from === 'curator') ||
                (userRole === 'business' && msg.from === 'business');
              
              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${isFromCurrentUser ? 'justify-end' : 'justify-start'}`}
                >
                  <div className="max-w-[90%] sm:max-w-[80%]">
                    <div className={`flex items-center gap-2 mb-1.5 ${isFromCurrentUser ? 'justify-end' : 'justify-start'}`}>
                      <span className="text-xs text-gray-500">{msg.fromName}</span>
                      <span className="text-xs text-gray-400">
                        {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div
                      className={`rounded-2xl p-4 ${
                        isFromCurrentUser
                          ? 'bg-gradient-to-br from-[#eb7825] to-[#d6691f] text-white rounded-br-md'
                          : msg.from === 'platform'
                          ? 'bg-gray-100 text-gray-900 rounded-bl-md'
                          : 'bg-blue-100 text-blue-900 rounded-bl-md'
                      }`}
                    >
                      <p className="leading-relaxed">{msg.message}</p>
                      {msg.proposedRate && (
                        <div className={`mt-3 pt-3 border-t ${isFromCurrentUser ? 'border-white/30' : 'border-gray-300'}`}>
                          <div className={`text-xs mb-1 ${isFromCurrentUser ? 'text-white/80' : 'text-gray-600'}`}>
                            Proposed Commission
                          </div>
                          <div className="flex items-baseline gap-1.5">
                            <span className="text-3xl">{msg.proposedRate}%</span>
                          </div>
                        </div>
                      )}
                    </div>
                    {msg.status && (
                      <div className={`mt-2 flex items-center gap-2 ${isFromCurrentUser ? 'justify-end' : 'justify-start'}`}>
                        <StatusChip status={msg.status} />
                        {!isFromCurrentUser && msg.status === 'pending' && (
                          <div className="flex gap-2">
                            <Button
                              onClick={() => handleApproveProposal(msg.id)}
                              size="sm"
                              className="bg-green-600 hover:bg-green-700 h-8 px-3"
                            >
                              <Check className="w-4 h-4 mr-1" />
                              Approve
                            </Button>
                            <Button
                              onClick={() => handleDeclineProposal(msg.id)}
                              size="sm"
                              variant="outline"
                              className="h-8 px-3 text-red-600 hover:text-red-700"
                            >
                              <X className="w-4 h-4 mr-1" />
                              Decline
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center max-w-sm">
              <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <MessageSquare className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-gray-900 mb-2">Start a Conversation</h3>
              <p className="text-sm text-gray-500">
                Use the calculator to propose a commission rate and begin negotiations
              </p>
            </div>
          </div>
        )}
      </div>
    );

    // Agreement Info Component
    const AgreementInfo = () => (
      <div className="space-y-3">
        <h4 className="text-gray-900 flex items-center gap-2">
          <FileText className="w-5 h-5 text-[#eb7825]" />
          Current Agreement
        </h4>
        <div className="bg-white rounded-xl border border-gray-200 divide-y divide-gray-100">
          <div className="p-4">
            <div className="text-xs text-gray-500 mb-1.5">Platform Fee (Fixed)</div>
            <div className="text-gray-900 text-2xl">{metrics.platformCommissionRate}%</div>
          </div>
          <div className="p-4">
            <div className="text-xs text-gray-500 mb-1.5">Curator Commission</div>
            <div className="text-[#eb7825] text-2xl mb-2">{metrics.curatorCommissionRate}%</div>
            {business.commissionStatus && (
              <StatusChip status={business.commissionStatus} />
            )}
          </div>
          <div className="p-4">
            <div className="text-xs text-gray-500 mb-1.5">Business Receives</div>
            <div className="text-green-600 text-2xl">
              {100 - metrics.platformCommissionRate - metrics.curatorCommissionRate}%
            </div>
          </div>
        </div>
      </div>
    );

    // Calculator Component
    const CalculatorSection = () => (
      <div className="space-y-4">
        <h4 className="text-gray-900 flex items-center gap-2">
          <Calculator className="w-5 h-5 text-[#eb7825]" />
          Propose New Rate
        </h4>
        
        {/* Rate Slider */}
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <label className="text-sm text-gray-700 mb-3 block">
            Curator Commission: <span className="text-[#eb7825]">{proposedRate}%</span>
          </label>
          <Slider
            value={[proposedRate]}
            onValueChange={(values) => setProposedRate(values[0])}
            min={5}
            max={30}
            step={1}
            className="mb-4"
          />
          <div className="grid grid-cols-3 gap-2">
            {[10, 15, 20].map(rate => (
              <button
                key={rate}
                onClick={() => setProposedRate(rate)}
                className={`px-3 py-2 rounded-lg text-sm transition-all ${
                  proposedRate === rate
                    ? 'bg-[#eb7825] text-white'
                    : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                }`}
              >
                {rate}%
              </button>
            ))}
          </div>
        </div>

        {/* Revenue Preview */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            <h5 className="text-blue-900">Revenue Split (per $100 sale)</h5>
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Sale Amount</span>
              <span className="text-gray-900">$100.00</span>
            </div>
            <Separator className="bg-blue-200" />
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Platform Fee</span>
              <div className="text-right">
                <div className="text-gray-900">-${(100 * metrics.platformCommissionRate / 100).toFixed(2)}</div>
                <div className="text-xs text-gray-500">{metrics.platformCommissionRate}%</div>
              </div>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-700">Curator Earns</span>
              <div className="text-right">
                <div className="text-[#eb7825]">-${(100 * proposedRate / 100).toFixed(2)}</div>
                <div className="text-xs text-gray-500">{proposedRate}%</div>
              </div>
            </div>
            <Separator className="bg-blue-200" />
            <div className="flex items-center justify-between">
              <span className="text-gray-900">Business Gets</span>
              <div className="text-right">
                <div className="text-green-600 text-xl">
                  ${(100 - (100 * metrics.platformCommissionRate / 100) - (100 * proposedRate / 100)).toFixed(2)}
                </div>
                <div className="text-xs text-gray-500">
                  {(100 - metrics.platformCommissionRate - proposedRate).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Message Input */}
        <div>
          <label className="text-sm text-gray-700 mb-2 block">
            Add a message (optional)
          </label>
          <Textarea
            value={negotiationMessage}
            onChange={(e) => setNegotiationMessage(e.target.value)}
            placeholder="Explain your proposal..."
            className="h-24 resize-none rounded-xl"
          />
        </div>

        {/* Info Notice */}
        <div className="bg-yellow-50 rounded-lg p-3 border border-yellow-200">
          <div className="flex gap-2">
            <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-700">
              Both parties must approve before the new rate takes effect. {userRole === 'curator' ? 'The business' : 'Your curator'} will be notified.
            </p>
          </div>
        </div>
      </div>
    );

    return (
      <div className="h-full flex flex-col">
        {/* Mobile: Tabbed Interface */}
        <div className="lg:hidden h-full flex flex-col">
          <Tabs defaultValue="chat" className="h-full flex flex-col">
            <TabsList className="grid w-full grid-cols-3 rounded-none bg-gray-100 border-b border-gray-200">
              <TabsTrigger value="chat" className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                <span className="hidden sm:inline">Chat</span>
              </TabsTrigger>
              <TabsTrigger value="calculator" className="flex items-center gap-2">
                <Calculator className="w-4 h-4" />
                <span className="hidden sm:inline">Calculator</span>
              </TabsTrigger>
              <TabsTrigger value="info" className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                <span className="hidden sm:inline">Info</span>
              </TabsTrigger>
            </TabsList>

            <TabsContent value="chat" className="flex-1 overflow-hidden mt-0">
              <ChatSection />
            </TabsContent>

            <TabsContent value="calculator" className="flex-1 overflow-y-auto p-4 mt-0 bg-gray-50">
              <CalculatorSection />
            </TabsContent>

            <TabsContent value="info" className="flex-1 overflow-y-auto p-4 mt-0 bg-gray-50">
              <AgreementInfo />
            </TabsContent>
          </Tabs>

          {/* Sticky Send Button for Mobile */}
          <div className="border-t border-gray-200 p-4 bg-white">
            <Button
              onClick={handleSendProposal}
              className="w-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] h-12"
            >
              <Send className="w-4 h-4 mr-2" />
              Send Proposal ({proposedRate}%)
            </Button>
          </div>
        </div>

        {/* Desktop: Split View */}
        <div className="hidden lg:flex h-full">
          {/* Left: Chat */}
          <div className="flex-1 border-r border-gray-200 flex flex-col">
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-gray-900 flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-[#eb7825]" />
                Negotiation Chat
              </h3>
              <p className="text-sm text-gray-500 mt-1">
                Discuss commission rates with the business
              </p>
            </div>
            <ChatSection />
          </div>

          {/* Right: Calculator & Info */}
          <div className="w-[440px] flex flex-col bg-gray-50">
            {/* Agreement Info - Top */}
            <div className="p-4 border-b border-gray-200 bg-white">
              <AgreementInfo />
            </div>

            {/* Calculator - Scrollable */}
            <div className="flex-1 overflow-y-auto p-4">
              <CalculatorSection />
            </div>

            {/* Send Button - Sticky Bottom */}
            <div className="border-t border-gray-200 p-4 bg-white">
              <Button
                onClick={handleSendProposal}
                className="w-full bg-gradient-to-br from-[#eb7825] to-[#d6691f] h-11"
              >
                <Send className="w-4 h-4 mr-2" />
                Send Proposal
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  };
  
  const renderPayoutsTab = () => (
    <div className="space-y-4 p-4 md:p-8">
      {/* Summary Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl p-4 border border-green-200">
          <div className="text-sm text-green-600 mb-1">Total Earned</div>
          <div className="text-2xl text-green-900">${metrics.netRevenue.toFixed(0)}</div>
          <div className="text-xs text-green-600 mt-1">All time</div>
        </div>
        <div className="bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl p-4 border border-yellow-200">
          <div className="text-sm text-yellow-600 mb-1">Pending Payout</div>
          <div className="text-2xl text-yellow-900">${metrics.pendingPayout.toFixed(0)}</div>
          <div className="text-xs text-yellow-600 mt-1">Next cycle</div>
        </div>
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl p-4 border border-blue-200">
          <div className="text-sm text-blue-600 mb-1">Last Payout</div>
          <div className="text-2xl text-blue-900">
            {business.lastPayoutDate 
              ? new Date(business.lastPayoutDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
              : 'N/A'}
          </div>
          <div className="text-xs text-blue-600 mt-1">
            {business.lastPayoutDate ? `$${metrics.totalPaidOut.toFixed(0)}` : 'No payouts yet'}
          </div>
        </div>
      </div>
      
      {/* Payout History */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-gray-900">Payout History</h3>
          <div className="flex gap-2">
            <Button
              onClick={() => handleExportPayouts('csv')}
              variant="outline"
              size="sm"
            >
              <Download className="w-4 h-4 mr-2" />
              CSV
            </Button>
            <Button
              onClick={() => handleExportPayouts('pdf')}
              variant="outline"
              size="sm"
            >
              <Download className="w-4 h-4 mr-2" />
              PDF
            </Button>
          </div>
        </div>
        
        {payouts.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="No payouts yet"
            description="Payouts are processed monthly. Your first payout will appear here after your first month of sales."
          />
        ) : (
          <div className="space-y-2">
            {payouts.map((payout) => (
              <motion.div
                key={payout.id}
                whileHover={{ scale: 1.01 }}
                className="bg-white rounded-lg p-4 border border-gray-200 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="text-gray-900">
                      {new Date(payout.periodStart).toLocaleDateString()} - {new Date(payout.periodEnd).toLocaleDateString()}
                    </div>
                    <div className="text-sm text-gray-500 mt-1">
                      {payout.purchaseCount} sale{payout.purchaseCount !== 1 ? 's' : ''}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <StatusChip status={payout.status} />
                      {payout.paidAt && (
                        <span className="text-xs text-gray-500">
                          Paid {new Date(payout.paidAt).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xl text-gray-900">${payout.amount.toFixed(2)}</div>
                    {payout.platformFee && payout.curatorCommission && (
                      <div className="text-xs text-gray-500 mt-1">
                        Platform: ${payout.platformFee.toFixed(2)}<br />
                        Curator: ${payout.curatorCommission.toFixed(2)}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
  
  const renderAnalyticsTab = () => (
    <div className="space-y-6 p-4 md:p-8">
      {/* Filters */}
      <div className="sticky top-0 bg-white z-10 pb-4">
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-full md:w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Last 7 days</SelectItem>
            <SelectItem value="30">Last 30 days</SelectItem>
            <SelectItem value="90">Last 90 days</SelectItem>
            <SelectItem value="180">Last 180 days</SelectItem>
          </SelectContent>
        </Select>
      </div>
      
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          icon={DollarSign}
          label="Total Revenue"
          value={`$${metrics.totalRevenue.toLocaleString()}`}
          delta="+12%"
          trend="up"
        />
        <KPICard
          icon={Target}
          label="Conversion Rate"
          value={`${metrics.conversionRate}%`}
          delta="+2.3%"
          trend="up"
        />
        <KPICard
          icon={Star}
          label="Avg Rating"
          value={metrics.avgRating.toFixed(1)}
          sublabel="From reviews"
        />
        <KPICard
          icon={Percent}
          label="Commission Earned"
          value={`$${metrics.curatorCommissions.toFixed(0)}`}
          sublabel={`${metrics.curatorCommissionRate}% rate`}
        />
      </div>
      
      {/* Revenue Trend */}
      <div className="bg-white rounded-xl p-4 border border-gray-200">
        <h3 className="text-gray-900 mb-4 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-green-600" />
          Revenue Trend
        </h3>
        <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
          <RechartsLine data={analyticsData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <RechartsTooltip />
            <Line type="monotone" dataKey="revenue" stroke="#eb7825" strokeWidth={2} dot={{ r: 4 }} />
          </RechartsLine>
        </ResponsiveContainer>
      </div>
      
      {/* Performance by Experience */}
      <div className="bg-white rounded-xl p-4 border border-gray-200">
        <h3 className="text-gray-900 mb-4 flex items-center gap-2">
          <BarChart3 className="w-5 h-5 text-blue-600" />
          Performance by Experience
        </h3>
        {experiencePerformanceData.length === 0 ? (
          <EmptyState
            icon={Package}
            title="No data yet"
            description="Create experiences to see performance metrics."
          />
        ) : (
          <ResponsiveContainer width="100%" height={isMobile ? 200 : 300}>
            <RechartsBar data={experiencePerformanceData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} angle={-45} textAnchor="end" height={80} />
              <YAxis tick={{ fontSize: 12 }} />
              <RechartsTooltip />
              <Bar dataKey="revenue" fill="#eb7825" radius={[8, 8, 0, 0]} />
            </RechartsBar>
          </ResponsiveContainer>
        )}
      </div>
      
      {/* Funnel Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="text-sm text-gray-600 mb-1">Total Views</div>
          <div className="text-2xl text-gray-900">{metrics.totalViews}</div>
          <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-blue-500" style={{ width: '100%' }} />
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="text-sm text-gray-600 mb-1">Bookings</div>
          <div className="text-2xl text-gray-900">{metrics.totalPurchases}</div>
          <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-green-500" style={{ width: `${(metrics.totalPurchases / metrics.totalViews) * 100}%` }} />
          </div>
        </div>
        <div className="bg-white rounded-xl p-4 border border-gray-200">
          <div className="text-sm text-gray-600 mb-1">Redemptions</div>
          <div className="text-2xl text-gray-900">{metrics.redeemedPurchases}</div>
          <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500" style={{ width: `${(metrics.redeemedPurchases / metrics.totalPurchases) * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
  
  const renderSettingsTab = () => (
    <div className="space-y-6 p-4 md:p-8">
      {/* Business Profile */}
      <div className="bg-white rounded-xl p-4 border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-gray-900 flex items-center gap-2">
            <Building2 className="w-5 h-5 text-gray-600" />
            Business Profile
          </h3>
          {isEditingBusiness ? (
            <div className="flex gap-2">
              <Button onClick={handleUpdateBusiness} size="sm" className="bg-[#eb7825] hover:bg-[#d6691f]">
                <Check className="w-4 h-4 mr-2" />
                Save
              </Button>
              <Button onClick={() => setIsEditingBusiness(false)} size="sm" variant="outline">
                Cancel
              </Button>
            </div>
          ) : (
            <Button onClick={() => setIsEditingBusiness(true)} size="sm" variant="outline">
              <Edit className="w-4 h-4 mr-2" />
              Edit
            </Button>
          )}
        </div>
        
        <div className="space-y-4">
          <div>
            <label className="text-sm text-gray-600 mb-1 block">Business Name <RoleChip role="business" /></label>
            <Input
              value={editedBusiness.name}
              onChange={(e) => setEditedBusiness({ ...editedBusiness, name: e.target.value })}
              disabled={!isEditingBusiness}
            />
          </div>

          <div>
            <label className="text-sm text-gray-600 mb-1 block">Business Category</label>
            <Select
              value={editedBusiness.category || ''}
              onValueChange={(value) => setEditedBusiness({ ...editedBusiness, category: value })}
              disabled={!isEditingBusiness}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select business category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dining-experiences">🍷 Dining Experiences (Fine dining, Chef's tables)</SelectItem>
                <SelectItem value="casual-eats">🍔 Casual Eats (Restaurants, Cafes, Food trucks)</SelectItem>
                <SelectItem value="sip-chill">🍸 Sip & Chill (Wine bars, Cocktail lounges)</SelectItem>
                <SelectItem value="creative-hands-on">🎨 Creative & Hands-On (Art, Crafts, Workshops)</SelectItem>
                <SelectItem value="picnics">🧺 Picnics & Outdoor Dining</SelectItem>
                <SelectItem value="wellness">🧘 Wellness & Fitness (Spa, Yoga, Meditation)</SelectItem>
                <SelectItem value="play-move">⚽ Play & Move (Sports, Activities, Adventures)</SelectItem>
                <SelectItem value="screen-relax">🎬 Screen & Relax (Movies, Shows, Entertainment)</SelectItem>
                <SelectItem value="freestyle">✨ Freestyle (Unique & Special experiences)</SelectItem>
                <SelectItem value="take-a-stroll">🚶 Take a Stroll (Walking tours, Parks)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div>
            <label className="text-sm text-gray-600 mb-1 block">Description</label>
            <Textarea
              value={editedBusiness.description || ''}
              onChange={(e) => setEditedBusiness({ ...editedBusiness, description: e.target.value })}
              disabled={!isEditingBusiness}
              rows={3}
            />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-600 mb-1 block">Email</label>
              <Input
                type="email"
                value={editedBusiness.email || ''}
                onChange={(e) => {
                  setEditedBusiness({ ...editedBusiness, email: e.target.value });
                  // Validate email
                  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                  if (e.target.value && !emailRegex.test(e.target.value)) {
                    e.target.setCustomValidity('Please enter a valid email address');
                  } else {
                    e.target.setCustomValidity('');
                  }
                }}
                disabled={!isEditingBusiness}
                placeholder="business@example.com"
              />
            </div>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">Phone</label>
              <div className="flex gap-2">
                <Select
                  value={editedBusiness.phoneCountryCode || '+1'}
                  onValueChange={(value) => setEditedBusiness({ ...editedBusiness, phoneCountryCode: value })}
                  disabled={!isEditingBusiness}
                >
                  <SelectTrigger className="w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    <SelectItem value="+93">🇦🇫 +93 Afghanistan</SelectItem>
                    <SelectItem value="+355">🇦🇱 +355 Albania</SelectItem>
                    <SelectItem value="+213">🇩🇿 +213 Algeria</SelectItem>
                    <SelectItem value="+1-684">🇦🇸 +1-684 American Samoa</SelectItem>
                    <SelectItem value="+376">🇦🇩 +376 Andorra</SelectItem>
                    <SelectItem value="+244">🇦🇴 +244 Angola</SelectItem>
                    <SelectItem value="+1-264">🇦🇮 +1-264 Anguilla</SelectItem>
                    <SelectItem value="+1-268">🇦🇬 +1-268 Antigua & Barbuda</SelectItem>
                    <SelectItem value="+54">🇦🇷 +54 Argentina</SelectItem>
                    <SelectItem value="+374">🇦🇲 +374 Armenia</SelectItem>
                    <SelectItem value="+297">🇦🇼 +297 Aruba</SelectItem>
                    <SelectItem value="+61">🇦🇺 +61 Australia</SelectItem>
                    <SelectItem value="+43">🇦🇹 +43 Austria</SelectItem>
                    <SelectItem value="+994">🇦🇿 +994 Azerbaijan</SelectItem>
                    <SelectItem value="+1-242">🇧🇸 +1-242 Bahamas</SelectItem>
                    <SelectItem value="+973">🇧🇭 +973 Bahrain</SelectItem>
                    <SelectItem value="+880">🇧🇩 +880 Bangladesh</SelectItem>
                    <SelectItem value="+1-246">🇧🇧 +1-246 Barbados</SelectItem>
                    <SelectItem value="+375">🇧🇾 +375 Belarus</SelectItem>
                    <SelectItem value="+32">🇧🇪 +32 Belgium</SelectItem>
                    <SelectItem value="+501">🇧🇿 +501 Belize</SelectItem>
                    <SelectItem value="+229">🇧🇯 +229 Benin</SelectItem>
                    <SelectItem value="+1-441">🇧🇲 +1-441 Bermuda</SelectItem>
                    <SelectItem value="+975">🇧🇹 +975 Bhutan</SelectItem>
                    <SelectItem value="+591">🇧🇴 +591 Bolivia</SelectItem>
                    <SelectItem value="+387">🇧🇦 +387 Bosnia & Herzegovina</SelectItem>
                    <SelectItem value="+267">🇧🇼 +267 Botswana</SelectItem>
                    <SelectItem value="+55">🇧🇷 +55 Brazil</SelectItem>
                    <SelectItem value="+673">🇧🇳 +673 Brunei</SelectItem>
                    <SelectItem value="+359">🇧🇬 +359 Bulgaria</SelectItem>
                    <SelectItem value="+226">🇧🇫 +226 Burkina Faso</SelectItem>
                    <SelectItem value="+257">🇧🇮 +257 Burundi</SelectItem>
                    <SelectItem value="+855">🇰🇭 +855 Cambodia</SelectItem>
                    <SelectItem value="+237">🇨🇲 +237 Cameroon</SelectItem>
                    <SelectItem value="+1">🇨🇦 +1 Canada</SelectItem>
                    <SelectItem value="+238">🇨🇻 +238 Cape Verde</SelectItem>
                    <SelectItem value="+1-345">🇰🇾 +1-345 Cayman Islands</SelectItem>
                    <SelectItem value="+236">🇨🇫 +236 Central African Republic</SelectItem>
                    <SelectItem value="+235">🇹🇩 +235 Chad</SelectItem>
                    <SelectItem value="+56">🇨🇱 +56 Chile</SelectItem>
                    <SelectItem value="+86">🇨🇳 +86 China</SelectItem>
                    <SelectItem value="+57">🇨🇴 +57 Colombia</SelectItem>
                    <SelectItem value="+269">🇰🇲 +269 Comoros</SelectItem>
                    <SelectItem value="+242">🇨🇬 +242 Congo</SelectItem>
                    <SelectItem value="+243">🇨🇩 +243 Congo (DRC)</SelectItem>
                    <SelectItem value="+682">🇨🇰 +682 Cook Islands</SelectItem>
                    <SelectItem value="+506">🇨🇷 +506 Costa Rica</SelectItem>
                    <SelectItem value="+225">🇨🇮 +225 Côte d'Ivoire</SelectItem>
                    <SelectItem value="+385">🇭🇷 +385 Croatia</SelectItem>
                    <SelectItem value="+53">🇨🇺 +53 Cuba</SelectItem>
                    <SelectItem value="+357">🇨🇾 +357 Cyprus</SelectItem>
                    <SelectItem value="+420">🇨🇿 +420 Czech Republic</SelectItem>
                    <SelectItem value="+45">🇩🇰 +45 Denmark</SelectItem>
                    <SelectItem value="+253">🇩🇯 +253 Djibouti</SelectItem>
                    <SelectItem value="+1-767">🇩🇲 +1-767 Dominica</SelectItem>
                    <SelectItem value="+1-809">🇩🇴 +1-809 Dominican Republic</SelectItem>
                    <SelectItem value="+593">🇪🇨 +593 Ecuador</SelectItem>
                    <SelectItem value="+20">🇪🇬 +20 Egypt</SelectItem>
                    <SelectItem value="+503">🇸🇻 +503 El Salvador</SelectItem>
                    <SelectItem value="+240">🇬🇶 +240 Equatorial Guinea</SelectItem>
                    <SelectItem value="+291">🇪🇷 +291 Eritrea</SelectItem>
                    <SelectItem value="+372">🇪🇪 +372 Estonia</SelectItem>
                    <SelectItem value="+251">🇪🇹 +251 Ethiopia</SelectItem>
                    <SelectItem value="+500">🇫🇰 +500 Falkland Islands</SelectItem>
                    <SelectItem value="+298">🇫🇴 +298 Faroe Islands</SelectItem>
                    <SelectItem value="+679">🇫🇯 +679 Fiji</SelectItem>
                    <SelectItem value="+358">🇫🇮 +358 Finland</SelectItem>
                    <SelectItem value="+33">🇫🇷 +33 France</SelectItem>
                    <SelectItem value="+594">🇬🇫 +594 French Guiana</SelectItem>
                    <SelectItem value="+689">🇵🇫 +689 French Polynesia</SelectItem>
                    <SelectItem value="+241">🇬🇦 +241 Gabon</SelectItem>
                    <SelectItem value="+220">🇬🇲 +220 Gambia</SelectItem>
                    <SelectItem value="+995">🇬🇪 +995 Georgia</SelectItem>
                    <SelectItem value="+49">🇩🇪 +49 Germany</SelectItem>
                    <SelectItem value="+233">🇬🇭 +233 Ghana</SelectItem>
                    <SelectItem value="+350">🇬🇮 +350 Gibraltar</SelectItem>
                    <SelectItem value="+30">🇬🇷 +30 Greece</SelectItem>
                    <SelectItem value="+299">🇬🇱 +299 Greenland</SelectItem>
                    <SelectItem value="+1-473">🇬🇩 +1-473 Grenada</SelectItem>
                    <SelectItem value="+590">🇬🇵 +590 Guadeloupe</SelectItem>
                    <SelectItem value="+1-671">🇬🇺 +1-671 Guam</SelectItem>
                    <SelectItem value="+502">🇬🇹 +502 Guatemala</SelectItem>
                    <SelectItem value="+224">🇬🇳 +224 Guinea</SelectItem>
                    <SelectItem value="+245">🇬🇼 +245 Guinea-Bissau</SelectItem>
                    <SelectItem value="+592">🇬🇾 +592 Guyana</SelectItem>
                    <SelectItem value="+509">🇭🇹 +509 Haiti</SelectItem>
                    <SelectItem value="+504">🇭🇳 +504 Honduras</SelectItem>
                    <SelectItem value="+852">🇭🇰 +852 Hong Kong</SelectItem>
                    <SelectItem value="+36">🇭🇺 +36 Hungary</SelectItem>
                    <SelectItem value="+354">🇮🇸 +354 Iceland</SelectItem>
                    <SelectItem value="+91">🇮🇳 +91 India</SelectItem>
                    <SelectItem value="+62">🇮🇩 +62 Indonesia</SelectItem>
                    <SelectItem value="+98">🇮🇷 +98 Iran</SelectItem>
                    <SelectItem value="+964">🇮🇶 +964 Iraq</SelectItem>
                    <SelectItem value="+353">🇮🇪 +353 Ireland</SelectItem>
                    <SelectItem value="+972">🇮🇱 +972 Israel</SelectItem>
                    <SelectItem value="+39">🇮🇹 +39 Italy</SelectItem>
                    <SelectItem value="+1-876">🇯🇲 +1-876 Jamaica</SelectItem>
                    <SelectItem value="+81">🇯🇵 +81 Japan</SelectItem>
                    <SelectItem value="+962">🇯🇴 +962 Jordan</SelectItem>
                    <SelectItem value="+7">🇰🇿 +7 Kazakhstan</SelectItem>
                    <SelectItem value="+254">🇰🇪 +254 Kenya</SelectItem>
                    <SelectItem value="+686">🇰🇮 +686 Kiribati</SelectItem>
                    <SelectItem value="+383">🇽🇰 +383 Kosovo</SelectItem>
                    <SelectItem value="+965">🇰🇼 +965 Kuwait</SelectItem>
                    <SelectItem value="+996">🇰🇬 +996 Kyrgyzstan</SelectItem>
                    <SelectItem value="+856">🇱🇦 +856 Laos</SelectItem>
                    <SelectItem value="+371">🇱🇻 +371 Latvia</SelectItem>
                    <SelectItem value="+961">🇱🇧 +961 Lebanon</SelectItem>
                    <SelectItem value="+266">🇱🇸 +266 Lesotho</SelectItem>
                    <SelectItem value="+231">🇱🇷 +231 Liberia</SelectItem>
                    <SelectItem value="+218">🇱🇾 +218 Libya</SelectItem>
                    <SelectItem value="+423">🇱🇮 +423 Liechtenstein</SelectItem>
                    <SelectItem value="+370">🇱🇹 +370 Lithuania</SelectItem>
                    <SelectItem value="+352">🇱🇺 +352 Luxembourg</SelectItem>
                    <SelectItem value="+853">🇲🇴 +853 Macau</SelectItem>
                    <SelectItem value="+389">🇲🇰 +389 North Macedonia</SelectItem>
                    <SelectItem value="+261">🇲🇬 +261 Madagascar</SelectItem>
                    <SelectItem value="+265">🇲🇼 +265 Malawi</SelectItem>
                    <SelectItem value="+60">🇲🇾 +60 Malaysia</SelectItem>
                    <SelectItem value="+960">🇲🇻 +960 Maldives</SelectItem>
                    <SelectItem value="+223">🇲🇱 +223 Mali</SelectItem>
                    <SelectItem value="+356">🇲🇹 +356 Malta</SelectItem>
                    <SelectItem value="+692">🇲🇭 +692 Marshall Islands</SelectItem>
                    <SelectItem value="+596">🇲🇶 +596 Martinique</SelectItem>
                    <SelectItem value="+222">🇲🇷 +222 Mauritania</SelectItem>
                    <SelectItem value="+230">🇲🇺 +230 Mauritius</SelectItem>
                    <SelectItem value="+52">🇲🇽 +52 Mexico</SelectItem>
                    <SelectItem value="+691">🇫🇲 +691 Micronesia</SelectItem>
                    <SelectItem value="+373">🇲🇩 +373 Moldova</SelectItem>
                    <SelectItem value="+377">🇲🇨 +377 Monaco</SelectItem>
                    <SelectItem value="+976">🇲🇳 +976 Mongolia</SelectItem>
                    <SelectItem value="+382">🇲🇪 +382 Montenegro</SelectItem>
                    <SelectItem value="+1-664">🇲🇸 +1-664 Montserrat</SelectItem>
                    <SelectItem value="+212">🇲🇦 +212 Morocco</SelectItem>
                    <SelectItem value="+258">🇲🇿 +258 Mozambique</SelectItem>
                    <SelectItem value="+95">🇲🇲 +95 Myanmar</SelectItem>
                    <SelectItem value="+264">🇳🇦 +264 Namibia</SelectItem>
                    <SelectItem value="+674">🇳🇷 +674 Nauru</SelectItem>
                    <SelectItem value="+977">🇳🇵 +977 Nepal</SelectItem>
                    <SelectItem value="+31">🇳🇱 +31 Netherlands</SelectItem>
                    <SelectItem value="+687">🇳🇨 +687 New Caledonia</SelectItem>
                    <SelectItem value="+64">🇳🇿 +64 New Zealand</SelectItem>
                    <SelectItem value="+505">🇳🇮 +505 Nicaragua</SelectItem>
                    <SelectItem value="+227">🇳🇪 +227 Niger</SelectItem>
                    <SelectItem value="+234">🇳🇬 +234 Nigeria</SelectItem>
                    <SelectItem value="+850">🇰🇵 +850 North Korea</SelectItem>
                    <SelectItem value="+47">🇳🇴 +47 Norway</SelectItem>
                    <SelectItem value="+968">🇴🇲 +968 Oman</SelectItem>
                    <SelectItem value="+92">🇵🇰 +92 Pakistan</SelectItem>
                    <SelectItem value="+680">🇵🇼 +680 Palau</SelectItem>
                    <SelectItem value="+970">🇵🇸 +970 Palestine</SelectItem>
                    <SelectItem value="+507">🇵🇦 +507 Panama</SelectItem>
                    <SelectItem value="+675">🇵🇬 +675 Papua New Guinea</SelectItem>
                    <SelectItem value="+595">🇵🇾 +595 Paraguay</SelectItem>
                    <SelectItem value="+51">🇵🇪 +51 Peru</SelectItem>
                    <SelectItem value="+63">🇵🇭 +63 Philippines</SelectItem>
                    <SelectItem value="+48">🇵🇱 +48 Poland</SelectItem>
                    <SelectItem value="+351">🇵🇹 +351 Portugal</SelectItem>
                    <SelectItem value="+1-787">🇵🇷 +1-787 Puerto Rico</SelectItem>
                    <SelectItem value="+974">🇶🇦 +974 Qatar</SelectItem>
                    <SelectItem value="+262">🇷🇪 +262 Réunion</SelectItem>
                    <SelectItem value="+40">🇷🇴 +40 Romania</SelectItem>
                    <SelectItem value="+7">🇷🇺 +7 Russia</SelectItem>
                    <SelectItem value="+250">🇷🇼 +250 Rwanda</SelectItem>
                    <SelectItem value="+685">🇼🇸 +685 Samoa</SelectItem>
                    <SelectItem value="+378">🇸🇲 +378 San Marino</SelectItem>
                    <SelectItem value="+239">🇸🇹 +239 São Tomé & Príncipe</SelectItem>
                    <SelectItem value="+966">🇸🇦 +966 Saudi Arabia</SelectItem>
                    <SelectItem value="+221">🇸🇳 +221 Senegal</SelectItem>
                    <SelectItem value="+381">🇷🇸 +381 Serbia</SelectItem>
                    <SelectItem value="+248">🇸🇨 +248 Seychelles</SelectItem>
                    <SelectItem value="+232">🇸🇱 +232 Sierra Leone</SelectItem>
                    <SelectItem value="+65">🇸🇬 +65 Singapore</SelectItem>
                    <SelectItem value="+421">🇸🇰 +421 Slovakia</SelectItem>
                    <SelectItem value="+386">🇸🇮 +386 Slovenia</SelectItem>
                    <SelectItem value="+677">🇸🇧 +677 Solomon Islands</SelectItem>
                    <SelectItem value="+252">🇸🇴 +252 Somalia</SelectItem>
                    <SelectItem value="+27">🇿🇦 +27 South Africa</SelectItem>
                    <SelectItem value="+82">🇰🇷 +82 South Korea</SelectItem>
                    <SelectItem value="+211">🇸🇸 +211 South Sudan</SelectItem>
                    <SelectItem value="+34">🇪🇸 +34 Spain</SelectItem>
                    <SelectItem value="+94">🇱🇰 +94 Sri Lanka</SelectItem>
                    <SelectItem value="+249">🇸🇩 +249 Sudan</SelectItem>
                    <SelectItem value="+597">🇸🇷 +597 Suriname</SelectItem>
                    <SelectItem value="+268">🇸🇿 +268 Eswatini</SelectItem>
                    <SelectItem value="+46">🇸🇪 +46 Sweden</SelectItem>
                    <SelectItem value="+41">🇨🇭 +41 Switzerland</SelectItem>
                    <SelectItem value="+963">🇸🇾 +963 Syria</SelectItem>
                    <SelectItem value="+886">🇹🇼 +886 Taiwan</SelectItem>
                    <SelectItem value="+992">🇹🇯 +992 Tajikistan</SelectItem>
                    <SelectItem value="+255">🇹🇿 +255 Tanzania</SelectItem>
                    <SelectItem value="+66">🇹🇭 +66 Thailand</SelectItem>
                    <SelectItem value="+670">🇹🇱 +670 Timor-Leste</SelectItem>
                    <SelectItem value="+228">🇹🇬 +228 Togo</SelectItem>
                    <SelectItem value="+676">🇹🇴 +676 Tonga</SelectItem>
                    <SelectItem value="+1-868">🇹🇹 +1-868 Trinidad & Tobago</SelectItem>
                    <SelectItem value="+216">🇹🇳 +216 Tunisia</SelectItem>
                    <SelectItem value="+90">🇹🇷 +90 Turkey</SelectItem>
                    <SelectItem value="+993">🇹🇲 +993 Turkmenistan</SelectItem>
                    <SelectItem value="+1-649">🇹🇨 +1-649 Turks & Caicos</SelectItem>
                    <SelectItem value="+688">🇹🇻 +688 Tuvalu</SelectItem>
                    <SelectItem value="+256">🇺🇬 +256 Uganda</SelectItem>
                    <SelectItem value="+380">🇺🇦 +380 Ukraine</SelectItem>
                    <SelectItem value="+971">🇦🇪 +971 UAE</SelectItem>
                    <SelectItem value="+44">🇬🇧 +44 United Kingdom</SelectItem>
                    <SelectItem value="+1">🇺🇸 +1 United States</SelectItem>
                    <SelectItem value="+598">🇺🇾 +598 Uruguay</SelectItem>
                    <SelectItem value="+998">🇺🇿 +998 Uzbekistan</SelectItem>
                    <SelectItem value="+678">🇻🇺 +678 Vanuatu</SelectItem>
                    <SelectItem value="+379">🇻🇦 +379 Vatican City</SelectItem>
                    <SelectItem value="+58">🇻🇪 +58 Venezuela</SelectItem>
                    <SelectItem value="+84">🇻🇳 +84 Vietnam</SelectItem>
                    <SelectItem value="+1-284">🇻🇬 +1-284 British Virgin Islands</SelectItem>
                    <SelectItem value="+1-340">🇻🇮 +1-340 US Virgin Islands</SelectItem>
                    <SelectItem value="+967">🇾🇪 +967 Yemen</SelectItem>
                    <SelectItem value="+260">🇿🇲 +260 Zambia</SelectItem>
                    <SelectItem value="+263">🇿🇼 +263 Zimbabwe</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="tel"
                  value={editedBusiness.phone || ''}
                  onChange={(e) => {
                    // Remove non-numeric characters
                    const cleaned = e.target.value.replace(/\D/g, '');
                    setEditedBusiness({ ...editedBusiness, phone: cleaned });
                    
                    // Validate phone based on country code
                    const countryCode = editedBusiness.phoneCountryCode || '+1';
                    let isValid = false;
                    
                    if (countryCode === '+1' && cleaned.length === 10) isValid = true; // US/Canada
                    else if (countryCode === '+44' && cleaned.length >= 10) isValid = true; // UK
                    else if (cleaned.length >= 7 && cleaned.length <= 15) isValid = true; // Generic
                    
                    if (cleaned && !isValid) {
                      e.target.setCustomValidity('Please enter a valid phone number');
                    } else {
                      e.target.setCustomValidity('');
                    }
                  }}
                  disabled={!isEditingBusiness}
                  placeholder="1234567890"
                  className="flex-1"
                />
              </div>
            </div>
          </div>
          
          <div>
            <label className="text-sm text-gray-600 mb-1 block">Country</label>
            <Select
              value={editedBusiness.addressCountry || ''}
              onValueChange={(value) => setEditedBusiness({ 
                ...editedBusiness, 
                addressCountry: value,
                addressState: '', // Reset state when country changes
                addressZip: ''
              })}
              disabled={!isEditingBusiness}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select country" />
              </SelectTrigger>
              <SelectContent className="max-h-[300px]">
                <SelectItem value="AF">🇦🇫 Afghanistan</SelectItem>
                <SelectItem value="AL">🇦🇱 Albania</SelectItem>
                <SelectItem value="DZ">🇩🇿 Algeria</SelectItem>
                <SelectItem value="AS">🇦🇸 American Samoa</SelectItem>
                <SelectItem value="AD">🇦🇩 Andorra</SelectItem>
                <SelectItem value="AO">🇦🇴 Angola</SelectItem>
                <SelectItem value="AI">🇦🇮 Anguilla</SelectItem>
                <SelectItem value="AQ">🇦🇶 Antarctica</SelectItem>
                <SelectItem value="AG">🇦🇬 Antigua & Barbuda</SelectItem>
                <SelectItem value="AR">🇦🇷 Argentina</SelectItem>
                <SelectItem value="AM">🇦🇲 Armenia</SelectItem>
                <SelectItem value="AW">🇦🇼 Aruba</SelectItem>
                <SelectItem value="AU">🇦🇺 Australia</SelectItem>
                <SelectItem value="AT">🇦🇹 Austria</SelectItem>
                <SelectItem value="AZ">🇦🇿 Azerbaijan</SelectItem>
                <SelectItem value="BS">🇧🇸 Bahamas</SelectItem>
                <SelectItem value="BH">🇧🇭 Bahrain</SelectItem>
                <SelectItem value="BD">🇧🇩 Bangladesh</SelectItem>
                <SelectItem value="BB">🇧🇧 Barbados</SelectItem>
                <SelectItem value="BY">🇧🇾 Belarus</SelectItem>
                <SelectItem value="BE">🇧🇪 Belgium</SelectItem>
                <SelectItem value="BZ">🇧🇿 Belize</SelectItem>
                <SelectItem value="BJ">🇧🇯 Benin</SelectItem>
                <SelectItem value="BM">🇧🇲 Bermuda</SelectItem>
                <SelectItem value="BT">🇧🇹 Bhutan</SelectItem>
                <SelectItem value="BO">🇧🇴 Bolivia</SelectItem>
                <SelectItem value="BA">🇧🇦 Bosnia & Herzegovina</SelectItem>
                <SelectItem value="BW">🇧🇼 Botswana</SelectItem>
                <SelectItem value="BR">🇧🇷 Brazil</SelectItem>
                <SelectItem value="IO">🇮🇴 British Indian Ocean Territory</SelectItem>
                <SelectItem value="VG">🇻🇬 British Virgin Islands</SelectItem>
                <SelectItem value="BN">🇧🇳 Brunei</SelectItem>
                <SelectItem value="BG">🇧🇬 Bulgaria</SelectItem>
                <SelectItem value="BF">🇧🇫 Burkina Faso</SelectItem>
                <SelectItem value="BI">🇧🇮 Burundi</SelectItem>
                <SelectItem value="KH">🇰🇭 Cambodia</SelectItem>
                <SelectItem value="CM">🇨🇲 Cameroon</SelectItem>
                <SelectItem value="CA">🇨🇦 Canada</SelectItem>
                <SelectItem value="CV">🇨🇻 Cape Verde</SelectItem>
                <SelectItem value="KY">🇰🇾 Cayman Islands</SelectItem>
                <SelectItem value="CF">🇨🇫 Central African Republic</SelectItem>
                <SelectItem value="TD">🇹🇩 Chad</SelectItem>
                <SelectItem value="CL">🇨🇱 Chile</SelectItem>
                <SelectItem value="CN">🇨🇳 China</SelectItem>
                <SelectItem value="CX">🇨🇽 Christmas Island</SelectItem>
                <SelectItem value="CC">🇨🇨 Cocos (Keeling) Islands</SelectItem>
                <SelectItem value="CO">🇨🇴 Colombia</SelectItem>
                <SelectItem value="KM">🇰🇲 Comoros</SelectItem>
                <SelectItem value="CG">🇨🇬 Congo - Brazzaville</SelectItem>
                <SelectItem value="CD">🇨🇩 Congo - Kinshasa</SelectItem>
                <SelectItem value="CK">🇨🇰 Cook Islands</SelectItem>
                <SelectItem value="CR">🇨🇷 Costa Rica</SelectItem>
                <SelectItem value="CI">🇨🇮 Côte d'Ivoire</SelectItem>
                <SelectItem value="HR">🇭🇷 Croatia</SelectItem>
                <SelectItem value="CU">🇨🇺 Cuba</SelectItem>
                <SelectItem value="CW">🇨🇼 Curaçao</SelectItem>
                <SelectItem value="CY">🇨🇾 Cyprus</SelectItem>
                <SelectItem value="CZ">🇨🇿 Czech Republic</SelectItem>
                <SelectItem value="DK">🇩🇰 Denmark</SelectItem>
                <SelectItem value="DJ">🇩🇯 Djibouti</SelectItem>
                <SelectItem value="DM">🇩🇲 Dominica</SelectItem>
                <SelectItem value="DO">🇩🇴 Dominican Republic</SelectItem>
                <SelectItem value="EC">🇪🇨 Ecuador</SelectItem>
                <SelectItem value="EG">🇪🇬 Egypt</SelectItem>
                <SelectItem value="SV">🇸🇻 El Salvador</SelectItem>
                <SelectItem value="GQ">🇬🇶 Equatorial Guinea</SelectItem>
                <SelectItem value="ER">🇪🇷 Eritrea</SelectItem>
                <SelectItem value="EE">🇪🇪 Estonia</SelectItem>
                <SelectItem value="SZ">🇸🇿 Eswatini</SelectItem>
                <SelectItem value="ET">🇪🇹 Ethiopia</SelectItem>
                <SelectItem value="FK">🇫🇰 Falkland Islands</SelectItem>
                <SelectItem value="FO">🇫🇴 Faroe Islands</SelectItem>
                <SelectItem value="FJ">🇫🇯 Fiji</SelectItem>
                <SelectItem value="FI">🇫🇮 Finland</SelectItem>
                <SelectItem value="FR">🇫🇷 France</SelectItem>
                <SelectItem value="GF">🇬🇫 French Guiana</SelectItem>
                <SelectItem value="PF">🇵🇫 French Polynesia</SelectItem>
                <SelectItem value="TF">🇹🇫 French Southern Territories</SelectItem>
                <SelectItem value="GA">🇬🇦 Gabon</SelectItem>
                <SelectItem value="GM">🇬🇲 Gambia</SelectItem>
                <SelectItem value="GE">🇬🇪 Georgia</SelectItem>
                <SelectItem value="DE">🇩🇪 Germany</SelectItem>
                <SelectItem value="GH">🇬🇭 Ghana</SelectItem>
                <SelectItem value="GI">🇬🇮 Gibraltar</SelectItem>
                <SelectItem value="GR">🇬🇷 Greece</SelectItem>
                <SelectItem value="GL">🇬🇱 Greenland</SelectItem>
                <SelectItem value="GD">🇬🇩 Grenada</SelectItem>
                <SelectItem value="GP">🇬🇵 Guadeloupe</SelectItem>
                <SelectItem value="GU">🇬🇺 Guam</SelectItem>
                <SelectItem value="GT">🇬🇹 Guatemala</SelectItem>
                <SelectItem value="GG">🇬🇬 Guernsey</SelectItem>
                <SelectItem value="GN">🇬🇳 Guinea</SelectItem>
                <SelectItem value="GW">🇬🇼 Guinea-Bissau</SelectItem>
                <SelectItem value="GY">🇬🇾 Guyana</SelectItem>
                <SelectItem value="HT">🇭🇹 Haiti</SelectItem>
                <SelectItem value="HN">🇭🇳 Honduras</SelectItem>
                <SelectItem value="HK">🇭🇰 Hong Kong</SelectItem>
                <SelectItem value="HU">🇭🇺 Hungary</SelectItem>
                <SelectItem value="IS">🇮🇸 Iceland</SelectItem>
                <SelectItem value="IN">🇮🇳 India</SelectItem>
                <SelectItem value="ID">🇮🇩 Indonesia</SelectItem>
                <SelectItem value="IR">🇮🇷 Iran</SelectItem>
                <SelectItem value="IQ">🇮🇶 Iraq</SelectItem>
                <SelectItem value="IE">🇮🇪 Ireland</SelectItem>
                <SelectItem value="IM">🇮🇲 Isle of Man</SelectItem>
                <SelectItem value="IL">🇮🇱 Israel</SelectItem>
                <SelectItem value="IT">🇮🇹 Italy</SelectItem>
                <SelectItem value="JM">🇯🇲 Jamaica</SelectItem>
                <SelectItem value="JP">🇯🇵 Japan</SelectItem>
                <SelectItem value="JE">🇯🇪 Jersey</SelectItem>
                <SelectItem value="JO">🇯🇴 Jordan</SelectItem>
                <SelectItem value="KZ">🇰🇿 Kazakhstan</SelectItem>
                <SelectItem value="KE">🇰🇪 Kenya</SelectItem>
                <SelectItem value="KI">🇰🇮 Kiribati</SelectItem>
                <SelectItem value="XK">🇽🇰 Kosovo</SelectItem>
                <SelectItem value="KW">🇰🇼 Kuwait</SelectItem>
                <SelectItem value="KG">🇰🇬 Kyrgyzstan</SelectItem>
                <SelectItem value="LA">🇱🇦 Laos</SelectItem>
                <SelectItem value="LV">🇱🇻 Latvia</SelectItem>
                <SelectItem value="LB">🇱🇧 Lebanon</SelectItem>
                <SelectItem value="LS">🇱🇸 Lesotho</SelectItem>
                <SelectItem value="LR">🇱🇷 Liberia</SelectItem>
                <SelectItem value="LY">🇱🇾 Libya</SelectItem>
                <SelectItem value="LI">🇱🇮 Liechtenstein</SelectItem>
                <SelectItem value="LT">🇱🇹 Lithuania</SelectItem>
                <SelectItem value="LU">🇱🇺 Luxembourg</SelectItem>
                <SelectItem value="MO">🇲🇴 Macau</SelectItem>
                <SelectItem value="MG">🇲🇬 Madagascar</SelectItem>
                <SelectItem value="MW">🇲🇼 Malawi</SelectItem>
                <SelectItem value="MY">🇲🇾 Malaysia</SelectItem>
                <SelectItem value="MV">🇲🇻 Maldives</SelectItem>
                <SelectItem value="ML">🇲🇱 Mali</SelectItem>
                <SelectItem value="MT">🇲🇹 Malta</SelectItem>
                <SelectItem value="MH">🇲🇭 Marshall Islands</SelectItem>
                <SelectItem value="MQ">🇲🇶 Martinique</SelectItem>
                <SelectItem value="MR">🇲🇷 Mauritania</SelectItem>
                <SelectItem value="MU">🇲🇺 Mauritius</SelectItem>
                <SelectItem value="YT">🇾🇹 Mayotte</SelectItem>
                <SelectItem value="MX">🇲🇽 Mexico</SelectItem>
                <SelectItem value="FM">🇫🇲 Micronesia</SelectItem>
                <SelectItem value="MD">🇲🇩 Moldova</SelectItem>
                <SelectItem value="MC">🇲🇨 Monaco</SelectItem>
                <SelectItem value="MN">🇲🇳 Mongolia</SelectItem>
                <SelectItem value="ME">🇲🇪 Montenegro</SelectItem>
                <SelectItem value="MS">🇲🇸 Montserrat</SelectItem>
                <SelectItem value="MA">🇲🇦 Morocco</SelectItem>
                <SelectItem value="MZ">🇲🇿 Mozambique</SelectItem>
                <SelectItem value="MM">🇲🇲 Myanmar (Burma)</SelectItem>
                <SelectItem value="NA">🇳🇦 Namibia</SelectItem>
                <SelectItem value="NR">🇳🇷 Nauru</SelectItem>
                <SelectItem value="NP">🇳🇵 Nepal</SelectItem>
                <SelectItem value="NL">🇳🇱 Netherlands</SelectItem>
                <SelectItem value="NC">🇳🇨 New Caledonia</SelectItem>
                <SelectItem value="NZ">🇳🇿 New Zealand</SelectItem>
                <SelectItem value="NI">🇳🇮 Nicaragua</SelectItem>
                <SelectItem value="NE">🇳🇪 Niger</SelectItem>
                <SelectItem value="NG">🇳🇬 Nigeria</SelectItem>
                <SelectItem value="NU">🇳🇺 Niue</SelectItem>
                <SelectItem value="NF">🇳🇫 Norfolk Island</SelectItem>
                <SelectItem value="KP">🇰🇵 North Korea</SelectItem>
                <SelectItem value="MK">🇲🇰 North Macedonia</SelectItem>
                <SelectItem value="MP">🇲🇵 Northern Mariana Islands</SelectItem>
                <SelectItem value="NO">🇳🇴 Norway</SelectItem>
                <SelectItem value="OM">🇴🇲 Oman</SelectItem>
                <SelectItem value="PK">🇵🇰 Pakistan</SelectItem>
                <SelectItem value="PW">🇵🇼 Palau</SelectItem>
                <SelectItem value="PS">🇵🇸 Palestine</SelectItem>
                <SelectItem value="PA">🇵🇦 Panama</SelectItem>
                <SelectItem value="PG">🇵🇬 Papua New Guinea</SelectItem>
                <SelectItem value="PY">🇵🇾 Paraguay</SelectItem>
                <SelectItem value="PE">🇵🇪 Peru</SelectItem>
                <SelectItem value="PH">🇵🇭 Philippines</SelectItem>
                <SelectItem value="PN">🇵🇳 Pitcairn Islands</SelectItem>
                <SelectItem value="PL">🇵🇱 Poland</SelectItem>
                <SelectItem value="PT">🇵🇹 Portugal</SelectItem>
                <SelectItem value="PR">🇵🇷 Puerto Rico</SelectItem>
                <SelectItem value="QA">🇶🇦 Qatar</SelectItem>
                <SelectItem value="RE">🇷🇪 Réunion</SelectItem>
                <SelectItem value="RO">🇷🇴 Romania</SelectItem>
                <SelectItem value="RU">🇷🇺 Russia</SelectItem>
                <SelectItem value="RW">🇷🇼 Rwanda</SelectItem>
                <SelectItem value="WS">🇼🇸 Samoa</SelectItem>
                <SelectItem value="SM">🇸🇲 San Marino</SelectItem>
                <SelectItem value="ST">🇸🇹 São Tomé & Príncipe</SelectItem>
                <SelectItem value="SA">🇸🇦 Saudi Arabia</SelectItem>
                <SelectItem value="SN">🇸🇳 Senegal</SelectItem>
                <SelectItem value="RS">🇷🇸 Serbia</SelectItem>
                <SelectItem value="SC">🇸🇨 Seychelles</SelectItem>
                <SelectItem value="SL">🇸🇱 Sierra Leone</SelectItem>
                <SelectItem value="SG">🇸🇬 Singapore</SelectItem>
                <SelectItem value="SX">🇸🇽 Sint Maarten</SelectItem>
                <SelectItem value="SK">🇸🇰 Slovakia</SelectItem>
                <SelectItem value="SI">🇸🇮 Slovenia</SelectItem>
                <SelectItem value="SB">🇸🇧 Solomon Islands</SelectItem>
                <SelectItem value="SO">🇸🇴 Somalia</SelectItem>
                <SelectItem value="ZA">🇿🇦 South Africa</SelectItem>
                <SelectItem value="GS">🇬🇸 South Georgia & South Sandwich Islands</SelectItem>
                <SelectItem value="KR">🇰🇷 South Korea</SelectItem>
                <SelectItem value="SS">🇸🇸 South Sudan</SelectItem>
                <SelectItem value="ES">🇪🇸 Spain</SelectItem>
                <SelectItem value="LK">🇱🇰 Sri Lanka</SelectItem>
                <SelectItem value="BL">🇧🇱 St. Barthélemy</SelectItem>
                <SelectItem value="SH">🇸🇭 St. Helena</SelectItem>
                <SelectItem value="KN">🇰🇳 St. Kitts & Nevis</SelectItem>
                <SelectItem value="LC">🇱🇨 St. Lucia</SelectItem>
                <SelectItem value="MF">🇲🇫 St. Martin</SelectItem>
                <SelectItem value="PM">🇵🇲 St. Pierre & Miquelon</SelectItem>
                <SelectItem value="VC">🇻🇨 St. Vincent & Grenadines</SelectItem>
                <SelectItem value="SD">🇸🇩 Sudan</SelectItem>
                <SelectItem value="SR">🇸🇷 Suriname</SelectItem>
                <SelectItem value="SJ">🇸🇯 Svalbard & Jan Mayen</SelectItem>
                <SelectItem value="SE">🇸🇪 Sweden</SelectItem>
                <SelectItem value="CH">🇨🇭 Switzerland</SelectItem>
                <SelectItem value="SY">🇸🇾 Syria</SelectItem>
                <SelectItem value="TW">🇹🇼 Taiwan</SelectItem>
                <SelectItem value="TJ">🇹🇯 Tajikistan</SelectItem>
                <SelectItem value="TZ">🇹🇿 Tanzania</SelectItem>
                <SelectItem value="TH">🇹🇭 Thailand</SelectItem>
                <SelectItem value="TL">🇹🇱 Timor-Leste</SelectItem>
                <SelectItem value="TG">🇹🇬 Togo</SelectItem>
                <SelectItem value="TK">🇹🇰 Tokelau</SelectItem>
                <SelectItem value="TO">🇹🇴 Tonga</SelectItem>
                <SelectItem value="TT">🇹🇹 Trinidad & Tobago</SelectItem>
                <SelectItem value="TN">🇹🇳 Tunisia</SelectItem>
                <SelectItem value="TR">🇹🇷 Turkey</SelectItem>
                <SelectItem value="TM">🇹🇲 Turkmenistan</SelectItem>
                <SelectItem value="TC">🇹🇨 Turks & Caicos Islands</SelectItem>
                <SelectItem value="TV">🇹🇻 Tuvalu</SelectItem>
                <SelectItem value="VI">🇻🇮 U.S. Virgin Islands</SelectItem>
                <SelectItem value="UG">🇺🇬 Uganda</SelectItem>
                <SelectItem value="UA">🇺🇦 Ukraine</SelectItem>
                <SelectItem value="AE">🇦🇪 United Arab Emirates</SelectItem>
                <SelectItem value="GB">🇬🇧 United Kingdom</SelectItem>
                <SelectItem value="US">🇺🇸 United States</SelectItem>
                <SelectItem value="UY">🇺🇾 Uruguay</SelectItem>
                <SelectItem value="UZ">🇺🇿 Uzbekistan</SelectItem>
                <SelectItem value="VU">🇻🇺 Vanuatu</SelectItem>
                <SelectItem value="VA">🇻🇦 Vatican City</SelectItem>
                <SelectItem value="VE">🇻🇪 Venezuela</SelectItem>
                <SelectItem value="VN">🇻🇳 Vietnam</SelectItem>
                <SelectItem value="WF">🇼🇫 Wallis & Futuna</SelectItem>
                <SelectItem value="EH">🇪🇭 Western Sahara</SelectItem>
                <SelectItem value="YE">🇾🇪 Yemen</SelectItem>
                <SelectItem value="ZM">🇿🇲 Zambia</SelectItem>
                <SelectItem value="ZW">🇿🇼 Zimbabwe</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-sm text-gray-600 mb-1 block">Street Address</label>
            <Input
              value={editedBusiness.addressStreet || ''}
              onChange={(e) => setEditedBusiness({ ...editedBusiness, addressStreet: e.target.value })}
              disabled={!isEditingBusiness}
              placeholder="123 Main Street"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-sm text-gray-600 mb-1 block">City</label>
              <Input
                value={editedBusiness.addressCity || ''}
                onChange={(e) => setEditedBusiness({ ...editedBusiness, addressCity: e.target.value })}
                disabled={!isEditingBusiness}
                placeholder="City"
              />
            </div>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">
                {editedBusiness.addressCountry === 'US' || editedBusiness.addressCountry === 'CA' ? 'State/Province' : 
                 editedBusiness.addressCountry === 'AU' ? 'State/Territory' :
                 editedBusiness.addressCountry === 'IN' ? 'State/Union Territory' :
                 editedBusiness.addressCountry === 'BR' || editedBusiness.addressCountry === 'MX' ? 'State' :
                 editedBusiness.addressCountry === 'DE' ? 'State (Bundesland)' :
                 'State/Region'}
              </label>
              {(() => {
                const statesMap: Record<string, string[]> = {
                  // North America
                  'US': ['Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming', 'District of Columbia'],
                  'CA': ['Alberta', 'British Columbia', 'Manitoba', 'New Brunswick', 'Newfoundland and Labrador', 'Northwest Territories', 'Nova Scotia', 'Nunavut', 'Ontario', 'Prince Edward Island', 'Quebec', 'Saskatchewan', 'Yukon'],
                  'MX': ['Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas', 'Chihuahua', 'Coahuila', 'Colima', 'Durango', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco', 'Mexico City', 'México', 'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro', 'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas'],
                  
                  // Europe - Western
                  'GB': ['England', 'Scotland', 'Wales', 'Northern Ireland'],
                  'IE': ['Carlow', 'Cavan', 'Clare', 'Cork', 'Donegal', 'Dublin', 'Galway', 'Kerry', 'Kildare', 'Kilkenny', 'Laois', 'Leitrim', 'Limerick', 'Longford', 'Louth', 'Mayo', 'Meath', 'Monaghan', 'Offaly', 'Roscommon', 'Sligo', 'Tipperary', 'Waterford', 'Westmeath', 'Wexford', 'Wicklow'],
                  'FR': ['Auvergne-Rhône-Alpes', 'Bourgogne-Franche-Comté', 'Brittany', 'Centre-Val de Loire', 'Corsica', 'Grand Est', 'Hauts-de-France', 'Île-de-France', 'Normandy', 'Nouvelle-Aquitaine', 'Occitanie', 'Pays de la Loire', 'Provence-Alpes-Côte d\'Azur'],
                  'BE': ['Antwerp', 'Brussels-Capital', 'East Flanders', 'Flemish Brabant', 'Hainaut', 'Liège', 'Limburg', 'Luxembourg', 'Namur', 'Walloon Brabant', 'West Flanders'],
                  'NL': ['Drenthe', 'Flevoland', 'Friesland', 'Gelderland', 'Groningen', 'Limburg', 'North Brabant', 'North Holland', 'Overijssel', 'South Holland', 'Utrecht', 'Zeeland'],
                  'LU': ['Capellen', 'Clervaux', 'Diekirch', 'Echternach', 'Esch-sur-Alzette', 'Grevenmacher', 'Luxembourg', 'Mersch', 'Redange', 'Remich', 'Vianden', 'Wiltz'],
                  
                  // Europe - Central
                  'DE': ['Baden-Württemberg', 'Bavaria', 'Berlin', 'Brandenburg', 'Bremen', 'Hamburg', 'Hesse', 'Lower Saxony', 'Mecklenburg-Vorpommern', 'North Rhine-Westphalia', 'Rhineland-Palatinate', 'Saarland', 'Saxony', 'Saxony-Anhalt', 'Schleswig-Holstein', 'Thuringia'],
                  'AT': ['Burgenland', 'Carinthia', 'Lower Austria', 'Salzburg', 'Styria', 'Tyrol', 'Upper Austria', 'Vienna', 'Vorarlberg'],
                  'CH': ['Aargau', 'Appenzell Ausserrhoden', 'Appenzell Innerrhoden', 'Basel-Landschaft', 'Basel-Stadt', 'Bern', 'Fribourg', 'Geneva', 'Glarus', 'Graubünden', 'Jura', 'Lucerne', 'Neuchâtel', 'Nidwalden', 'Obwalden', 'Schaffhausen', 'Schwyz', 'Solothurn', 'St. Gallen', 'Thurgau', 'Ticino', 'Uri', 'Valais', 'Vaud', 'Zug', 'Zürich'],
                  'PL': ['Greater Poland', 'Kuyavian-Pomeranian', 'Lesser Poland', 'Lodz', 'Lower Silesian', 'Lublin', 'Lubusz', 'Masovian', 'Opole', 'Podkarpackie', 'Podlaskie', 'Pomeranian', 'Silesian', 'Świętokrzyskie', 'Warmian-Masurian', 'West Pomeranian'],
                  'CZ': ['Central Bohemia', 'Hradec Králové', 'Karlovy Vary', 'Liberec', 'Moravia-Silesia', 'Olomouc', 'Pardubice', 'Plzeň', 'Prague', 'South Bohemia', 'South Moravia', 'Ústí nad Labem', 'Vysočina', 'Zlín'],
                  'SK': ['Banská Bystrica', 'Bratislava', 'Košice', 'Nitra', 'Prešov', 'Trenčín', 'Trnava', 'Žilina'],
                  'HU': ['Bács-Kiskun', 'Baranya', 'Békés', 'Borsod-Abaúj-Zemplén', 'Budapest', 'Csongrád-Csanád', 'Fejér', 'Győr-Moson-Sopron', 'Hajdú-Bihar', 'Heves', 'Jász-Nagykun-Szolnok', 'Komárom-Esztergom', 'Nógrád', 'Pest', 'Somogy', 'Szabolcs-Szatmár-Bereg', 'Tolna', 'Vas', 'Veszprém', 'Zala'],
                  
                  // Europe - Southern
                  'ES': ['Andalusia', 'Aragon', 'Asturias', 'Balearic Islands', 'Basque Country', 'Canary Islands', 'Cantabria', 'Castile and León', 'Castile-La Mancha', 'Catalonia', 'Ceuta', 'Extremadura', 'Galicia', 'La Rioja', 'Madrid', 'Melilla', 'Murcia', 'Navarre', 'Valencia'],
                  'IT': ['Abruzzo', 'Aosta Valley', 'Apulia', 'Basilicata', 'Calabria', 'Campania', 'Emilia-Romagna', 'Friuli-Venezia Giulia', 'Lazio', 'Liguria', 'Lombardy', 'Marche', 'Molise', 'Piedmont', 'Sardinia', 'Sicily', 'Trentino-South Tyrol', 'Tuscany', 'Umbria', 'Veneto'],
                  'PT': ['Aveiro', 'Azores', 'Beja', 'Braga', 'Bragança', 'Castelo Branco', 'Coimbra', 'Évora', 'Faro', 'Guarda', 'Leiria', 'Lisbon', 'Madeira', 'Portalegre', 'Porto', 'Santarém', 'Setúbal', 'Viana do Castelo', 'Vila Real', 'Viseu'],
                  'GR': ['Attica', 'Central Greece', 'Central Macedonia', 'Crete', 'East Macedonia and Thrace', 'Epirus', 'Ionian Islands', 'North Aegean', 'Peloponnese', 'South Aegean', 'Thessaly', 'West Greece', 'West Macedonia'],
                  'MT': ['Attard', 'Balzan', 'Birgu', 'Birkirkara', 'Birżebbuġa', 'Cospicua', 'Dingli', 'Fgura', 'Floriana', 'Fontana', 'Għajnsielem', 'Għarb', 'Għargħur', 'Għasri', 'Għaxaq', 'Gudja', 'Gżira', 'Ħamrun', 'Iklin', 'Kalkara', 'Kerċem', 'Kirkop', 'Lija', 'Luqa', 'Marsa', 'Marsaskala', 'Marsaxlokk', 'Mdina', 'Mellieħa', 'Mġarr', 'Mosta', 'Mqabba', 'Msida', 'Mtarfa', 'Munxar', 'Nadur', 'Naxxar', 'Paola', 'Pembroke', 'Pietà', 'Qala', 'Qormi', 'Qrendi', 'Rabat (Gozo)', 'Rabat (Malta)', 'Safi', 'San Ġiljan', 'San Ġwann', 'San Lawrenz', 'Sannat', 'Santa Luċija', 'Santa Venera', 'Senglea', 'Siġġiewi', 'Sliema', 'Swieqi', 'Ta\' Xbiex', 'Tarxien', 'Valletta', 'Victoria', 'Xagħra', 'Xewkija', 'Xgħajra', 'Żabbar', 'Żebbuġ (Gozo)', 'Żebbuġ (Malta)', 'Żejtun', 'Żurrieq'],
                  
                  // Europe - Eastern
                  'RO': ['Alba', 'Arad', 'Argeș', 'Bacău', 'Bihor', 'Bistrița-Năsăud', 'Botoșani', 'Brăila', 'Brașov', 'Bucharest', 'Buzău', 'Călărași', 'Caraș-Severin', 'Cluj', 'Constanța', 'Covasna', 'Dâmbovița', 'Dolj', 'Galați', 'Giurgiu', 'Gorj', 'Harghita', 'Hunedoara', 'Ialomița', 'Iași', 'Ilfov', 'Maramureș', 'Mehedinți', 'Mureș', 'Neamț', 'Olt', 'Prahova', 'Sălaj', 'Satu Mare', 'Sibiu', 'Suceava', 'Teleorman', 'Timiș', 'Tulcea', 'Vâlcea', 'Vaslui', 'Vrancea'],
                  'BG': ['Blagoevgrad', 'Burgas', 'Dobrich', 'Gabrovo', 'Haskovo', 'Kardzhali', 'Kyustendil', 'Lovech', 'Montana', 'Pazardzhik', 'Pernik', 'Pleven', 'Plovdiv', 'Razgrad', 'Ruse', 'Shumen', 'Silistra', 'Sliven', 'Smolyan', 'Sofia', 'Sofia City', 'Stara Zagora', 'Targovishte', 'Varna', 'Veliko Tarnovo', 'Vidin', 'Vratsa', 'Yambol'],
                  'HR': ['Bjelovar-Bilogora', 'Brod-Posavina', 'Dubrovnik-Neretva', 'Istria', 'Karlovac', 'Koprivnica-Križevci', 'Krapina-Zagorje', 'Lika-Senj', 'Međimurje', 'Osijek-Baranja', 'Požega-Slavonia', 'Primorje-Gorski Kotar', 'Šibenik-Knin', 'Sisak-Moslavina', 'Split-Dalmatia', 'Varaždin', 'Virovitica-Podravina', 'Vukovar-Srijem', 'Zadar', 'Zagreb', 'Zagreb County'],
                  'SI': ['Carinthia', 'Carniola', 'Central Sava', 'Coastal–Karst', 'Drava', 'Gorizia', 'Littoral–Inner Carniola', 'Lower Sava', 'Mura', 'Savinja', 'Southeast Slovenia', 'Upper Carniola'],
                  'RS': ['Belgrade', 'Bor', 'Braničevo', 'Central Banat', 'Jablanica', 'Kolubara', 'Mačva', 'Moravica', 'Nišava', 'North Bačka', 'North Banat', 'Pčinja', 'Pirot', 'Podunavlje', 'Pomoravlje', 'Rasina', 'Raška', 'South Bačka', 'South Banat', 'Šumadija', 'Toplica', 'West Bačka', 'Zaječar', 'Zlatibor'],
                  'BA': ['Brčko District', 'Federation of Bosnia and Herzegovina', 'Republika Srpska'],
                  'ME': ['Andrijevica', 'Bar', 'Berane', 'Bijelo Polje', 'Budva', 'Cetinje', 'Danilovgrad', 'Gusinje', 'Herceg Novi', 'Kolašin', 'Kotor', 'Mojkovac', 'Nikšić', 'Petnjica', 'Plav', 'Pljevlja', 'Plužine', 'Podgorica', 'Rožaje', 'Šavnik', 'Tivat', 'Tuzi', 'Ulcinj', 'Žabljak'],
                  'MK': ['Aerodrom', 'Aračinovo', 'Berovo', 'Bitola', 'Bogdanci', 'Bogovinje', 'Bosilovo', 'Brvenica', 'Čair', 'Čaška', 'Centar', 'Centar Župa', 'Češinovo-Obleševo', 'Čučer-Sandevo', 'Debarca', 'Delčevo', 'Demir Hisar', 'Demir Kapija', 'Dojran', 'Dolneni', 'Gazi Baba', 'Gevgelija', 'Gostivar', 'Gradsko', 'Ilinden', 'Jegunovce', 'Karbinci', 'Kavadarci', 'Kičevo', 'Konče', 'Kočani', 'Kratovo', 'Kriva Palanka', 'Krivogaštani', 'Kruševo', 'Kumanovo', 'Lipkovo', 'Lozovo', 'Makedonska Kamenica', 'Makedonski Brod', 'Mavrovo and Rostuša', 'Mogila', 'Negotino', 'Novaci', 'Novo Selo', 'Ohrid', 'Pehčevo', 'Petrovec', 'Plasnica', 'Prilep', 'Probištip', 'Radoviš', 'Rankovce', 'Resen', 'Rosoman', 'Saraj', 'Sopište', 'Staro Nagoričane', 'Štip', 'Struga', 'Strumica', 'Studeničani', 'Sveti Nikole', 'Tearce', 'Tetovo', 'Valandovo', 'Vasilevo', 'Veles', 'Vevčani', 'Vinica', 'Vrapčište', 'Zelenikovo', 'Zrnovci'],
                  'AL': ['Berat', 'Dibër', 'Durrës', 'Elbasan', 'Fier', 'Gjirokastër', 'Korçë', 'Kukës', 'Lezhë', 'Shkodër', 'Tirana', 'Vlorë'],
                  'XK': ['Đakovica', 'Dragash', 'Ferizaj', 'Gjakova', 'Gjilan', 'Istog', 'Kamenica', 'Klina', 'Kosovo Polje', 'Leposavić', 'Lipljan', 'Mitrovica', 'Obiliq', 'Peć', 'Podujevo', 'Pristina', 'Prizren', 'Skenderaj', 'Štrpce', 'Suva Reka', 'Uroševac', 'Viti', 'Vučitrn', 'Zubin Potok', 'Zvečan'],
                  
                  // Europe - Nordic
                  'SE': ['Blekinge', 'Dalarna', 'Gävleborg', 'Gotland', 'Halland', 'Jämtland', 'Jönköping', 'Kalmar', 'Kronoberg', 'Norrbotten', 'Örebro', 'Östergötland', 'Skåne', 'Södermanland', 'Stockholm', 'Uppsala', 'Värmland', 'Västerbotten', 'Västernorrland', 'Västmanland', 'Västra Götaland'],
                  'NO': ['Agder', 'Innlandet', 'Møre og Romsdal', 'Nordland', 'Oslo', 'Rogaland', 'Troms og Finnmark', 'Trøndelag', 'Vestfold og Telemark', 'Vestland', 'Viken'],
                  'DK': ['Capital Region', 'Central Denmark', 'North Denmark', 'Region Zealand', 'South Denmark'],
                  'FI': ['Åland', 'Central Finland', 'Central Ostrobothnia', 'Kainuu', 'Kymenlaakso', 'Lapland', 'North Karelia', 'North Ostrobothnia', 'Northern Savonia', 'Ostrobothnia', 'Päijänne Tavastia', 'Pirkanmaa', 'Satakunta', 'South Karelia', 'South Ostrobothnia', 'Southern Savonia', 'Southwest Finland', 'Tavastia Proper', 'Uusimaa'],
                  'IS': ['Capital Region', 'Northeast', 'Northwest', 'South', 'Southern Peninsula', 'West', 'Westfjords'],
                  
                  // Europe - Baltic
                  'EE': ['Harju', 'Hiiu', 'Ida-Viru', 'Järva', 'Jõgeva', 'Lääne', 'Lääne-Viru', 'Pärnu', 'Põlva', 'Rapla', 'Saare', 'Tartu', 'Valga', 'Viljandi', 'Võru'],
                  'LV': ['Aizkraukle', 'Alūksne', 'Balvi', 'Bauska', 'Cēsis', 'Daugavpils', 'Dobele', 'Gulbene', 'Jēkabpils', 'Jelgava', 'Krāslava', 'Kuldīga', 'Liepāja', 'Limbaži', 'Ludza', 'Madona', 'Ogre', 'Preiļi', 'Rēzekne', 'Riga', 'Saldus', 'Talsi', 'Tukums', 'Valka', 'Valmiera', 'Ventspils'],
                  'LT': ['Alytus', 'Kaunas', 'Klaipėda', 'Marijampolė', 'Panevėžys', 'Šiauliai', 'Tauragė', 'Telšiai', 'Utena', 'Vilnius'],
                  
                  // Europe - Other
                  'UA': ['Cherkasy', 'Chernihiv', 'Chernivtsi', 'Dnipropetrovsk', 'Donetsk', 'Ivano-Frankivsk', 'Kharkiv', 'Kherson', 'Khmelnytskyi', 'Kyiv', 'Kirovohrad', 'Luhansk', 'Lviv', 'Mykolaiv', 'Odessa', 'Poltava', 'Rivne', 'Sumy', 'Ternopil', 'Vinnytsia', 'Volyn', 'Zakarpattia', 'Zaporizhzhia', 'Zhytomyr'],
                  'BY': ['Brest', 'Gomel', 'Grodno', 'Minsk', 'Mogilev', 'Vitebsk'],
                  'MD': ['Anenii Noi', 'Bălți', 'Basarabeasca', 'Bender', 'Briceni', 'Cahul', 'Călărași', 'Cantemir', 'Căușeni', 'Chișinău', 'Cimișlia', 'Criuleni', 'Dondușeni', 'Drochia', 'Dubăsari', 'Edineț', 'Fălești', 'Florești', 'Gagauzia', 'Glodeni', 'Hîncești', 'Ialoveni', 'Nisporeni', 'Ocnița', 'Orhei', 'Rezina', 'Rîșcani', 'Sîngerei', 'Șoldănești', 'Soroca', 'Ștefan Vodă', 'Strășeni', 'Taraclia', 'Telenești', 'Transnistria', 'Ungheni'],
                  'CY': ['Famagusta', 'Kyrenia', 'Larnaca', 'Limassol', 'Nicosia', 'Paphos'],
                  
                  // Asia
                  'JP': ['Aichi', 'Akita', 'Aomori', 'Chiba', 'Ehime', 'Fukui', 'Fukuoka', 'Fukushima', 'Gifu', 'Gunma', 'Hiroshima', 'Hokkaido', 'Hyogo', 'Ibaraki', 'Ishikawa', 'Iwate', 'Kagawa', 'Kagoshima', 'Kanagawa', 'Kochi', 'Kumamoto', 'Kyoto', 'Mie', 'Miyagi', 'Miyazaki', 'Nagano', 'Nagasaki', 'Nara', 'Niigata', 'Oita', 'Okayama', 'Okinawa', 'Osaka', 'Saga', 'Saitama', 'Shiga', 'Shimane', 'Shizuoka', 'Tochigi', 'Tokushima', 'Tokyo', 'Tottori', 'Toyama', 'Wakayama', 'Yamagata', 'Yamaguchi', 'Yamanashi'],
                  'CN': ['Anhui', 'Beijing', 'Chongqing', 'Fujian', 'Gansu', 'Guangdong', 'Guangxi', 'Guizhou', 'Hainan', 'Hebei', 'Heilongjiang', 'Henan', 'Hubei', 'Hunan', 'Inner Mongolia', 'Jiangsu', 'Jiangxi', 'Jilin', 'Liaoning', 'Ningxia', 'Qinghai', 'Shaanxi', 'Shandong', 'Shanghai', 'Shanxi', 'Sichuan', 'Tianjin', 'Tibet', 'Xinjiang', 'Yunnan', 'Zhejiang'],
                  'IN': ['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'],
                  'MY': ['Johor', 'Kedah', 'Kelantan', 'Kuala Lumpur', 'Labuan', 'Malacca', 'Negeri Sembilan', 'Pahang', 'Penang', 'Perak', 'Perlis', 'Putrajaya', 'Sabah', 'Sarawak', 'Selangor', 'Terengganu'],
                  'PH': ['Abra', 'Agusan del Norte', 'Agusan del Sur', 'Aklan', 'Albay', 'Antique', 'Apayao', 'Aurora', 'Basilan', 'Bataan', 'Batanes', 'Batangas', 'Benguet', 'Biliran', 'Bohol', 'Bukidnon', 'Bulacan', 'Cagayan', 'Camarines Norte', 'Camarines Sur', 'Camiguin', 'Capiz', 'Catanduanes', 'Cavite', 'Cebu', 'Cotabato', 'Davao de Oro', 'Davao del Norte', 'Davao del Sur', 'Davao Occidental', 'Davao Oriental', 'Dinagat Islands', 'Eastern Samar', 'Guimaras', 'Ifugao', 'Ilocos Norte', 'Ilocos Sur', 'Iloilo', 'Isabela', 'Kalinga', 'La Union', 'Laguna', 'Lanao del Norte', 'Lanao del Sur', 'Leyte', 'Maguindanao', 'Marinduque', 'Masbate', 'Metro Manila', 'Misamis Occidental', 'Misamis Oriental', 'Mountain Province', 'Negros Occidental', 'Negros Oriental', 'Northern Samar', 'Nueva Ecija', 'Nueva Vizcaya', 'Occidental Mindoro', 'Oriental Mindoro', 'Palawan', 'Pampanga', 'Pangasinan', 'Quezon', 'Quirino', 'Rizal', 'Romblon', 'Samar', 'Sarangani', 'Siquijor', 'Sorsogon', 'South Cotabato', 'Southern Leyte', 'Sultan Kudarat', 'Sulu', 'Surigao del Norte', 'Surigao del Sur', 'Tarlac', 'Tawi-Tawi', 'Zambales', 'Zamboanga del Norte', 'Zamboanga del Sur', 'Zamboanga Sibugay'],
                  
                  // South America & Oceania
                  'BR': ['Acre', 'Alagoas', 'Amapá', 'Amazonas', 'Bahia', 'Ceará', 'Distrito Federal', 'Espírito Santo', 'Goiás', 'Maranhão', 'Mato Grosso', 'Mato Grosso do Sul', 'Minas Gerais', 'Pará', 'Paraíba', 'Paraná', 'Pernambuco', 'Piauí', 'Rio de Janeiro', 'Rio Grande do Norte', 'Rio Grande do Sul', 'Rondônia', 'Roraima', 'Santa Catarina', 'São Paulo', 'Sergipe', 'Tocantins'],
                  'AR': ['Buenos Aires', 'Catamarca', 'Chaco', 'Chubut', 'Córdoba', 'Corrientes', 'Entre Ríos', 'Formosa', 'Jujuy', 'La Pampa', 'La Rioja', 'Mendoza', 'Misiones', 'Neuquén', 'Río Negro', 'Salta', 'San Juan', 'San Luis', 'Santa Cruz', 'Santa Fe', 'Santiago del Estero', 'Tierra del Fuego', 'Tucumán'],
                  'AU': ['Australian Capital Territory', 'New South Wales', 'Northern Territory', 'Queensland', 'South Australia', 'Tasmania', 'Victoria', 'Western Australia'],
                  'NZ': ['Auckland', 'Bay of Plenty', 'Canterbury', 'Gisborne', 'Hawke\'s Bay', 'Manawatū-Whanganui', 'Marlborough', 'Nelson', 'Northland', 'Otago', 'Southland', 'Taranaki', 'Tasman', 'Waikato', 'Wellington', 'West Coast'],
                  
                  // Africa
                  'ZA': ['Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape'],
                  'NG': ['Abia', 'Adamawa', 'Akwa Ibom', 'Anambra', 'Bauchi', 'Bayelsa', 'Benue', 'Borno', 'Cross River', 'Delta', 'Ebonyi', 'Edo', 'Ekiti', 'Enugu', 'Federal Capital Territory', 'Gombe', 'Imo', 'Jigawa', 'Kaduna', 'Kano', 'Katsina', 'Kebbi', 'Kogi', 'Kwara', 'Lagos', 'Nasarawa', 'Niger', 'Ogun', 'Ondo', 'Osun', 'Oyo', 'Plateau', 'Rivers', 'Sokoto', 'Taraba', 'Yobe', 'Zamfara'],
                };

                const states = statesMap[editedBusiness.addressCountry || ''];
                
                if (states && states.length > 0) {
                  return (
                    <Select
                      value={editedBusiness.addressState || ''}
                      onValueChange={(value) => setEditedBusiness({ ...editedBusiness, addressState: value })}
                      disabled={!isEditingBusiness}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select state/region" />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px]">
                        {states.map((state) => (
                          <SelectItem key={state} value={state}>{state}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  );
                } else {
                  return (
                    <Input
                      value={editedBusiness.addressState || ''}
                      onChange={(e) => setEditedBusiness({ ...editedBusiness, addressState: e.target.value })}
                      disabled={!isEditingBusiness}
                      placeholder="State/Region"
                    />
                  );
                }
              })()}
            </div>
            <div>
              <label className="text-sm text-gray-600 mb-1 block">
                {editedBusiness.addressCountry === 'US' ? 'ZIP Code' : 
                 editedBusiness.addressCountry === 'GB' ? 'Postcode' : 'Postal Code'}
              </label>
              <Input
                value={editedBusiness.addressZip || ''}
                onChange={(e) => {
                  const value = e.target.value;
                  setEditedBusiness({ ...editedBusiness, addressZip: value });
                  
                  // Validate based on country
                  let isValid = false;
                  if (editedBusiness.addressCountry === 'US') {
                    isValid = /^\d{5}(-\d{4})?$/.test(value); // 12345 or 12345-6789
                  } else if (editedBusiness.addressCountry === 'GB') {
                    isValid = /^[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}$/i.test(value); // UK postcode
                  } else if (editedBusiness.addressCountry === 'CA') {
                    isValid = /^[A-Z]\d[A-Z]\s?\d[A-Z]\d$/i.test(value); // K1A 0B1
                  } else {
                    isValid = value.length >= 3; // Generic
                  }
                  
                  if (value && !isValid) {
                    e.target.setCustomValidity('Please enter a valid postal code');
                  } else {
                    e.target.setCustomValidity('');
                  }
                }}
                disabled={!isEditingBusiness}
                placeholder={editedBusiness.addressCountry === 'US' ? '94102' : 
                           editedBusiness.addressCountry === 'GB' ? 'SW1A 1AA' : '12345'}
              />
            </div>
          </div>
          
          <div>
            <label className="text-sm text-gray-600 mb-1 block">Website</label>
            <Input
              type="url"
              value={editedBusiness.website || ''}
              onChange={(e) => {
                setEditedBusiness({ ...editedBusiness, website: e.target.value });
                
                // Validate URL
                try {
                  if (e.target.value && !e.target.value.startsWith('http://') && !e.target.value.startsWith('https://')) {
                    e.target.setCustomValidity('URL must start with http:// or https://');
                  } else if (e.target.value) {
                    new URL(e.target.value);
                    e.target.setCustomValidity('');
                  } else {
                    e.target.setCustomValidity('');
                  }
                } catch {
                  e.target.setCustomValidity('Please enter a valid URL');
                }
              }}
              disabled={!isEditingBusiness}
              placeholder="https://www.example.com"
            />
            {editedBusiness.website && !editedBusiness.website.startsWith('http') && (
              <p className="text-xs text-amber-600 mt-1">URL should start with http:// or https://</p>
            )}
          </div>
        </div>
      </div>
      
      {/* Business Team Members */}
      <div className="bg-white rounded-xl p-4 border border-gray-200">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-gray-900 flex items-center gap-2">
              <Users className="w-5 h-5 text-gray-600" />
              Business Team Members
            </h3>
            <p className="text-xs text-gray-500 mt-1">Invite business users to help manage this business profile</p>
          </div>
          <Button
            onClick={() => {
              const email = prompt('Enter business user email:');
              const role = prompt('Enter role (manager/viewer):');
              if (email && (role === 'manager' || role === 'viewer')) {
                handleInviteCollaborator(email, role);
              } else if (email) {
                alert('Role must be either "manager" or "viewer"');
              }
            }}
            size="sm"
            variant="outline"
          >
            <Plus className="w-4 h-4 mr-2" />
            Invite Business User
          </Button>
        </div>
        
        {collaborators.length === 0 ? (
          <div className="text-center py-8 px-4 bg-gray-50 rounded-lg">
            <Users className="w-12 h-12 text-gray-400 mx-auto mb-3" />
            <p className="text-gray-600 mb-1">No business team members yet</p>
            <p className="text-sm text-gray-500">Invite business users to help manage this business profile and view analytics</p>
          </div>
        ) : (
          <div className="space-y-2">
            {collaborators.map(collab => (
              <div key={collab.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <div className="text-gray-900">{collab.name}</div>
                  <div className="text-sm text-gray-500">{collab.email}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <Badge variant="outline" className="text-xs capitalize">{collab.role}</Badge>
                    <StatusChip status={collab.status} />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={() => handleToggleCollaboratorStatus(collab.id)}
                    size="sm"
                    variant="outline"
                  >
                    {collab.status === 'active' ? 'Suspend' : 'Activate'}
                  </Button>
                  <Button
                    onClick={() => handleRemoveCollaborator(collab.id)}
                    size="sm"
                    variant="outline"
                    className="text-red-600"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      
      {/* Payment Settings */}
      <div className="bg-white rounded-xl p-4 border border-gray-200">
        <h3 className="text-gray-900 mb-4 flex items-center gap-2">
          <CreditCard className="w-5 h-5 text-gray-600" />
          Payment Settings
        </h3>
        
        <div className="space-y-4">
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-gray-900">Stripe</div>
                <div className="text-sm text-gray-500">
                  {business.stripeConnected ? 'Connected' : 'Not connected'}
                </div>
              </div>
            </div>
            <Button size="sm" variant={business.stripeConnected ? 'outline' : 'default'}>
              {business.stripeConnected ? 'Disconnect' : 'Connect'}
            </Button>
          </div>
          
          <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-gray-900">PayPal</div>
                <div className="text-sm text-gray-500">
                  {business.paypalConnected ? 'Connected' : 'Not connected'}
                </div>
              </div>
            </div>
            <Button size="sm" variant={business.paypalConnected ? 'outline' : 'default'}>
              {business.paypalConnected ? 'Disconnect' : 'Connect'}
            </Button>
          </div>
        </div>
      </div>
      
      {/* Notifications */}
      <div className="bg-white rounded-xl p-4 border border-gray-200">
        <h3 className="text-gray-900 mb-4 flex items-center gap-2">
          <Bell className="w-5 h-5 text-gray-600" />
          Notifications
        </h3>
        
        <div className="space-y-4">
          <div>
            <h4 className="text-sm text-gray-700 mb-3">Email Notifications</h4>
            <div className="space-y-3">
              {Object.entries({
                emailProposals: 'Commission proposals',
                emailApprovals: 'Experience approvals',
                emailPayouts: 'Payout confirmations',
                emailSales: 'New sales',
              }).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{label}</span>
                  <Switch
                    checked={notifications[key as keyof typeof notifications]}
                    onCheckedChange={(checked) =>
                      setNotifications({ ...notifications, [key]: checked })
                    }
                  />
                </div>
              ))}
            </div>
          </div>
          
          <Separator />
          
          <div>
            <h4 className="text-sm text-gray-700 mb-3">Push Notifications</h4>
            <div className="space-y-3">
              {Object.entries({
                pushProposals: 'Commission proposals',
                pushApprovals: 'Experience approvals',
                pushPayouts: 'Payout confirmations',
                pushSales: 'New sales',
              }).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">{label}</span>
                  <Switch
                    checked={notifications[key as keyof typeof notifications]}
                    onCheckedChange={(checked) =>
                      setNotifications({ ...notifications, [key]: checked })
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      
      {/* Danger Zone */}
      <div className="bg-red-50 rounded-xl p-4 border border-red-200">
        <h3 className="text-red-900 mb-4 flex items-center gap-2">
          <AlertCircle className="w-5 h-5" />
          Danger Zone
        </h3>
        <div className="space-y-3">
          <Button variant="outline" className="w-full text-red-600 border-red-300 hover:bg-red-100">
            <Shield className="w-4 h-4 mr-2" />
            Suspend Business
          </Button>
          <Button variant="outline" className="w-full text-red-600 border-red-300 hover:bg-red-100">
            <Trash2 className="w-4 h-4 mr-2" />
            Delete Business
          </Button>
        </div>
      </div>
    </div>
  );
  
  // =========================================================================
  // MAIN RENDER
  // =========================================================================
  
  if (!isOpen) return null;
  
  if (isMobile) {
    return (
      <>
        {/* Custom backdrop overlay for modal={false} */}
        {isOpen && (
          <div 
            className="fixed inset-0 bg-black/50 z-40"
            style={{ pointerEvents: 'none' }}
            aria-hidden="true"
          />
        )}
        <Sheet 
          open={isOpen} 
          onOpenChange={(open) => {
            // Prevent closing if any sub-modal is open
            if (!open && (showCreateCard || showEditCard || showQRValidator || showInviteModal)) {
              return;
            }
            // Don't close if just opening side menu
            if (!open && sideMenuOpen) {
              return;
            }
            onClose();
          }} 
          modal={false}
        >
          <SheetContent 
            className="w-full h-full p-0" 
            side="right" 
            style={{ pointerEvents: 'auto' }}
            onPointerDownOutside={(e) => {
              // Prevent closing when interacting with portaled modals
              const target = e.target as HTMLElement;
              if (target.closest('[data-modal-portal]')) {
                e.preventDefault();
              }
            }}
            onInteractOutside={(e) => {
              // Prevent closing when interacting with portaled modals
              const target = e.target as HTMLElement;
              if (target.closest('[data-modal-portal]')) {
                e.preventDefault();
              }
            }}
          >
            <SheetTitle className="sr-only">Manage Business - {business.name}</SheetTitle>
            <SheetDescription className="sr-only">
              Manage business settings, experiences, sales, and analytics for {business.name}
            </SheetDescription>
            <div className="flex flex-col h-full">
              {/* Header - RadixUI close button is top-right, we add padding to avoid overlap */}
              <div className="flex items-center gap-3 p-4 pr-14 border-b border-gray-200 bg-white">
                {/* Hamburger Menu Button */}
                <button
                  type="button"
                  onClick={() => setSideMenuOpen(true)}
                  className="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors flex-shrink-0"
                  aria-label="Open menu"
                >
                  <Menu className="w-5 h-5 text-gray-700" />
                </button>
                
                <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center flex-shrink-0">
                  {business.logo ? (
                    <img src={business.logo} alt={business.name} className="w-full h-full object-cover rounded-lg" />
                  ) : (
                    <Building2 className="w-5 h-5 text-white" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="text-gray-900 truncate">Manage Business</h2>
                  <p className="text-sm text-gray-500 truncate">{business.name}</p>
                </div>
              </div>
              
              {/* Tab Navigation */}
              {renderTabBar()}
              
              {/* Current Tab Indicator (Mobile Only) */}
              {isMobile && (
                <div className="bg-white px-4 py-2 border-b border-gray-200">
                  <p className="text-xs text-gray-500 uppercase tracking-wide">
                    {(() => {
                      const currentTab = [
                        { id: 'overview', label: 'Overview' },
                        { id: 'experiences', label: 'Experiences' },
                        { id: 'sales', label: 'Sales' },
                        { id: 'negotiations', label: 'Negotiations & Commissions' },
                        { id: 'payouts', label: 'Payouts' },
                        { id: 'analytics', label: 'Analytics' },
                        { id: 'settings', label: 'Settings' },
                      ].find(t => t.id === activeTab);
                      return currentTab?.label || 'Overview';
                    })()}
                  </p>
                </div>
              )}
              
              {/* Tab Content */}
              <div className="flex-1 overflow-y-auto bg-gray-50">
                {activeTab === 'overview' && renderOverviewTab()}
                {activeTab === 'experiences' && renderExperiencesTab()}
                {activeTab === 'sales' && renderSalesTab()}
                {activeTab === 'negotiations' && renderNegotiationsTab()}
                {activeTab === 'payouts' && renderPayoutsTab()}
                {activeTab === 'analytics' && renderAnalyticsTab()}
                {activeTab === 'settings' && renderSettingsTab()}
              </div>
            </div>
          </SheetContent>
        </Sheet>
        
        {/* Mobile Side Menu - Custom sliding panel to avoid Sheet conflicts */}
        <AnimatePresence>
          {sideMenuOpen && (
            <ModalPortal>
              {/* Overlay */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 bg-black/50 z-[60]"
                onClick={() => setSideMenuOpen(false)}
              />
              
              {/* Side Menu Panel */}
              <motion.div
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 30, stiffness: 300 }}
                className="fixed left-0 top-0 bottom-0 w-[280px] bg-white shadow-2xl z-[61] flex flex-col"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Close Button */}
                <button
                  onClick={() => setSideMenuOpen(false)}
                  className="absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
                  aria-label="Close menu"
                >
                  <X className="w-4 h-4" />
                </button>
                
                {/* Menu Header */}
                <div className="p-4 border-b border-gray-200">
                  <h3 className="text-gray-900">Menu</h3>
                  <p className="text-sm text-gray-500 mt-1">Navigate sections</p>
                </div>
                
                {/* Menu Items */}
                <div className="flex-1 overflow-y-auto py-2">
                  {[
                    { id: 'overview', label: 'Overview', icon: BarChart3 },
                    { id: 'experiences', label: 'Experiences', icon: Package },
                    { id: 'sales', label: 'Sales', icon: DollarSign },
                    { id: 'negotiations', label: 'Negotiations & Commissions', icon: MessageSquare },
                    { id: 'payouts', label: 'Payouts', icon: CreditCard },
                    { id: 'analytics', label: 'Analytics', icon: LineChart },
                    { id: 'settings', label: 'Settings', icon: SettingsIcon },
                  ].map(tab => {
                    const Icon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                      <button
                        key={tab.id}
                        onClick={() => {
                          setActiveTab(tab.id);
                          setSideMenuOpen(false);
                        }}
                        className={`w-full flex items-center gap-3 px-4 py-3 transition-colors ${
                          isActive
                            ? 'bg-gradient-to-r from-[#eb7825]/10 to-transparent border-l-4 border-[#eb7825] text-[#eb7825]'
                            : 'text-gray-700 hover:bg-gray-50'
                        }`}
                      >
                        <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-[#eb7825]' : 'text-gray-500'}`} />
                        <span>{tab.label}</span>
                      </button>
                    );
                  })}
                </div>
                
                {/* Menu Footer */}
                <div className="p-4 border-t border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    <Building2 className="w-4 h-4" />
                    <span className="truncate">{business.name}</span>
                  </div>
                </div>
              </motion.div>
            </ModalPortal>
          )}
        </AnimatePresence>
        
        {/* Sub-modals - Rendered in Portal to bypass Sheet's inert mode */}
        <ModalPortal>
          <AnimatePresence>
          {showCreateCard && (
            <CardCreatorModal
              key="mobile-create-card-modal"
              isOpen={showCreateCard}
              onClose={() => {
                setShowCreateCard(false);
              }}
              onSave={handleSaveNewExperience}
              preSelectedBusinessId={business.id}
              preSelectedBusinessName={business.name}
            />
          )}
          
          {showEditCard && selectedCard && (
            <CardEditorModal
              key="mobile-edit-card-modal"
              isOpen={showEditCard}
              onClose={() => {
                setShowEditCard(false);
                setSelectedCard(null);
              }}
              cardData={selectedCard}
              onSave={(updatedCard) => {
                // Update the card in localStorage
                const stored = localStorage.getItem('mingla_cards');
                if (stored) {
                  const cards = JSON.parse(stored);
                  const updatedCards = cards.map((c: any) => c.id === updatedCard.id ? updatedCard : c);
                  localStorage.setItem('mingla_cards', JSON.stringify(updatedCards));
                }
                setShowEditCard(false);
                setSelectedCard(null);
                setRefreshTrigger(prev => prev + 1);
              }}
              mode="edit"
            />
          )}
          
          {showQRValidator && (
            <QRCodeValidationModal
              key="mobile-qr-validator-modal"
              isOpen={showQRValidator}
              onClose={() => {
                setShowQRValidator(false);
                setSelectedPurchase(null);
                setRefreshTrigger(prev => prev + 1);
              }}
              businessId={business.id}
              businessName={business.name}
            />
          )}
          
          {showInviteModal && (
            <BusinessInviteModal
              key="mobile-invite-modal"
              isOpen={showInviteModal}
              onClose={() => setShowInviteModal(false)}
              business={business}
              curatorName={business.curatorName || 'Curator'}
              curatorId={currentUserId}
            />
          )}
          </AnimatePresence>
        </ModalPortal>
      </>
    );
  }
  
  // Desktop version
  return (
    <>
      {/* Custom backdrop overlay for modal={false} */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40"
          style={{ pointerEvents: 'none' }}
          aria-hidden="true"
        />
      )}
      <Dialog 
        open={isOpen} 
        onOpenChange={(open) => {
          // Prevent closing if any sub-modal is open
          if (!open && (showCreateCard || showEditCard || showQRValidator || showInviteModal)) {
            return;
          }
          onClose();
        }} 
        modal={false}
      >
        <DialogContent 
          className="p-0 gap-0 overflow-hidden"
          style={{
            width: '98vw',
            maxWidth: '1600px',
            height: '92vh',
            maxHeight: '1200px',
            pointerEvents: 'auto'
          }}
          onPointerDownOutside={(e) => {
            // Prevent closing when interacting with portaled modals
            const target = e.target as HTMLElement;
            if (target.closest('[data-modal-portal]')) {
              e.preventDefault();
            }
          }}
          onInteractOutside={(e) => {
            // Prevent closing when interacting with portaled modals
            const target = e.target as HTMLElement;
            if (target.closest('[data-modal-portal]')) {
              e.preventDefault();
            }
          }}
        >
          <DialogTitle className="sr-only">Manage Business - {business.name}</DialogTitle>
          <DialogDescription className="sr-only">
            Manage business settings, experiences, sales, and analytics for {business.name}
          </DialogDescription>
          <div className="flex flex-col h-full overflow-hidden">
            {/* Header - RadixUI close button is top-right, we add padding to avoid overlap */}
            <div className="flex items-center gap-4 px-8 py-5 pr-16 border-b border-gray-200 bg-white rounded-t-lg flex-shrink-0">
              <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-[#eb7825] to-[#d6691f] flex items-center justify-center flex-shrink-0">
                {business.logo ? (
                  <img src={business.logo} alt={business.name} className="w-full h-full object-cover rounded-lg" />
                ) : (
                  <Building2 className="w-6 h-6 text-white" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-gray-900 truncate text-xl">Manage Business</h2>
                <p className="text-gray-500 truncate">{business.name}</p>
              </div>
            </div>
            
            {/* Tab Navigation */}
            {renderTabBar()}
            
            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto bg-gray-50 min-h-0">
              {activeTab === 'overview' && renderOverviewTab()}
              {activeTab === 'experiences' && renderExperiencesTab()}
              {activeTab === 'sales' && renderSalesTab()}
              {activeTab === 'negotiations' && renderNegotiationsTab()}
              {activeTab === 'payouts' && renderPayoutsTab()}
              {activeTab === 'analytics' && renderAnalyticsTab()}
              {activeTab === 'settings' && renderSettingsTab()}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      
      {/* Sub-modals - Rendered in Portal to bypass Dialog's inert mode */}
      <ModalPortal>
        <AnimatePresence>
          {showCreateCard && (
            <CardCreatorModal
              key="desktop-create-card-modal"
              isOpen={showCreateCard}
              onClose={() => {
                setShowCreateCard(false);
              }}
              onSave={handleSaveNewExperience}
              preSelectedBusinessId={business.id}
              preSelectedBusinessName={business.name}
            />
          )}
          
          {showEditCard && selectedCard && (
            <CardEditorModal
              key="desktop-edit-card-modal"
              isOpen={showEditCard}
              onClose={() => {
                setShowEditCard(false);
                setSelectedCard(null);
              }}
              cardData={selectedCard}
              onSave={(updatedCard) => {
                // Update the card in localStorage
                const stored = localStorage.getItem('mingla_cards');
                if (stored) {
                  const cards = JSON.parse(stored);
                  const updatedCards = cards.map((c: any) => c.id === updatedCard.id ? updatedCard : c);
                  localStorage.setItem('mingla_cards', JSON.stringify(updatedCards));
                }
                setShowEditCard(false);
                setSelectedCard(null);
                setRefreshTrigger(prev => prev + 1);
              }}
              mode="edit"
            />
          )}
          
          {showQRValidator && (
            <QRCodeValidationModal
              key="desktop-qr-validator-modal"
              isOpen={showQRValidator}
              onClose={() => {
                setShowQRValidator(false);
                setSelectedPurchase(null);
                setRefreshTrigger(prev => prev + 1);
              }}
              businessId={business.id}
              businessName={business.name}
            />
          )}
          
          {showInviteModal && (
            <BusinessInviteModal
              key="desktop-invite-modal"
              isOpen={showInviteModal}
              onClose={() => setShowInviteModal(false)}
              business={business}
              curatorName={business.curatorName || 'Curator'}
              curatorId={currentUserId}
            />
          )}
        </AnimatePresence>
      </ModalPortal>
    </>
  );
}
