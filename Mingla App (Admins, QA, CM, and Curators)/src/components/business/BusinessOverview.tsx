import React from 'react';
import { 
  TrendingUp, Package, DollarSign, Eye, Heart, 
  BarChart3, ArrowUpRight, ArrowDownRight, Plus, MessageCircle,
  Clock, CheckCircle, Users, Target, Zap, QrCode, ShoppingCart,
  Star, TrendingDown, Calendar, AlertCircle
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import BusinessPageLayout from './BusinessPageLayout';

interface BusinessOverviewProps {
  businessData?: any;
  onNavigate: (tab: string) => void;
  onOpenCreateCard: () => void;
  onOpenQRValidator: () => void;
  stats: {
    totalExperiences: number;
    liveExperiences: number;
    inReview: number;
    drafts: number;
    totalPurchases: number;
    redeemedCount: number;
    pendingCount: number;
  };
  metrics: {
    totalRevenue: number;
    platformFees: number;
    platformCommissionRate: number;
    curatorCommissions: number;
    netRevenue: number;
  };
  formatCurrency: (amount: number) => string;
}

export default function BusinessOverview({ 
  businessData, 
  onNavigate, 
  onOpenCreateCard,
  onOpenQRValidator,
  stats,
  metrics,
  formatCurrency
}: BusinessOverviewProps) {
  return (
    <BusinessPageLayout
      title={`Welcome back, ${businessData?.name || 'Business Owner'}!`}
      description="Here's your business performance overview"
      actions={
        <div className="flex flex-col sm:flex-row gap-2">
          <Button 
            onClick={onOpenQRValidator}
            className="bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-700 hover:to-emerald-700 text-white"
          >
            <QrCode className="w-4 h-4 mr-2" />
            Quick Validate
          </Button>
          <Button 
            onClick={onOpenCreateCard}
            className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create Experience
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Key Performance Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#6B7280] text-sm">Net Revenue</p>
                <p className="text-[#111827] text-3xl mt-2">{formatCurrency(metrics.netRevenue)}</p>
                <p className="text-[#10B981] text-sm mt-2 flex items-center gap-1">
                  <ArrowUpRight className="w-4 h-4" />
                  After fees & commissions
                </p>
              </div>
              <div className="p-3 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl">
                <DollarSign className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#6B7280] text-sm">Total Sales</p>
                <p className="text-[#111827] text-3xl mt-2">{stats.totalPurchases}</p>
                <p className="text-[#10B981] text-sm mt-2 flex items-center gap-1">
                  <ArrowUpRight className="w-4 h-4" />
                  {stats.redeemedCount} redeemed
                </p>
              </div>
              <div className="p-3 bg-gradient-to-br from-[#eb7825]/10 to-[#d6691f]/10 rounded-xl">
                <ShoppingCart className="w-6 h-6 text-[#eb7825]" />
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#6B7280] text-sm">Live Experiences</p>
                <p className="text-[#111827] text-3xl mt-2">{stats.liveExperiences}</p>
                <p className="text-[#6B7280] text-sm mt-2 flex items-center gap-1">
                  <Package className="w-4 h-4" />
                  of {stats.totalExperiences} total
                </p>
              </div>
              <div className="p-3 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl">
                <Package className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#6B7280] text-sm">Pending Orders</p>
                <p className="text-[#111827] text-3xl mt-2">{stats.pendingCount}</p>
                <p className="text-[#6B7280] text-sm mt-2 flex items-center gap-1">
                  <Clock className="w-4 h-4" />
                  Awaiting redemption
                </p>
              </div>
              <div className="p-3 bg-gradient-to-br from-yellow-50 to-orange-50 rounded-xl">
                <Clock className="w-6 h-6 text-yellow-600" />
              </div>
            </div>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card className="p-4 sm:p-6 border border-gray-200 hover:shadow-md transition-shadow">
            <h2 className="text-[#111827] mb-3 sm:mb-4">Quick Actions</h2>
            <div className="space-y-2 sm:space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start gap-2 sm:gap-3 h-auto py-3 sm:py-4 px-3 sm:px-4"
                onClick={onOpenCreateCard}
              >
                <div className="p-1.5 sm:p-2 bg-[#eb7825]/10 rounded-lg flex-shrink-0">
                  <Plus className="w-4 h-4 sm:w-5 sm:h-5 text-[#eb7825]" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-[#111827] truncate">Create New Experience</p>
                  <p className="text-[#6B7280] text-xs sm:text-sm truncate">Design a new experience card</p>
                </div>
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start gap-2 sm:gap-3 h-auto py-3 sm:py-4 px-3 sm:px-4"
                onClick={onOpenQRValidator}
              >
                <div className="p-1.5 sm:p-2 bg-green-50 rounded-lg flex-shrink-0">
                  <QrCode className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-[#111827] truncate">Validate Purchase</p>
                  <p className="text-[#6B7280] text-xs sm:text-sm truncate">Scan QR code to redeem order</p>
                </div>
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start gap-2 sm:gap-3 h-auto py-3 sm:py-4 px-3 sm:px-4"
                onClick={() => onNavigate('sales')}
              >
                <div className="p-1.5 sm:p-2 bg-[#eb7825]/10 rounded-lg flex-shrink-0">
                  <TrendingUp className="w-4 h-4 sm:w-5 sm:h-5 text-[#eb7825]" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-[#111827] truncate">View Sales</p>
                  <p className="text-[#6B7280] text-xs sm:text-sm truncate">Track all purchases and revenue</p>
                </div>
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start gap-2 sm:gap-3 h-auto py-3 sm:py-4 px-3 sm:px-4"
                onClick={() => onNavigate('analytics')}
              >
                <div className="p-1.5 sm:p-2 bg-blue-50 rounded-lg flex-shrink-0">
                  <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="text-[#111827] truncate">View Analytics</p>
                  <p className="text-[#6B7280] text-xs sm:text-sm truncate">Track performance metrics</p>
                </div>
              </Button>
            </div>
          </Card>

          {/* Experience Status Overview */}
          <Card className="p-6 border border-gray-200 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-[#111827]">Experience Status</h2>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => onNavigate('experiences')}
                className="text-[#eb7825] hover:text-[#d6691f]"
              >
                View All
              </Button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-emerald-50 to-green-50 rounded-xl border border-emerald-200">
                <div className="flex items-center gap-3">
                  <CheckCircle className="w-5 h-5 text-emerald-600" />
                  <div>
                    <p className="text-[#111827]">Live Cards</p>
                    <p className="text-[#6B7280] text-sm">Published and active</p>
                  </div>
                </div>
                <p className="text-2xl text-emerald-600">{stats.liveExperiences}</p>
              </div>

              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200">
                <div className="flex items-center gap-3">
                  <Clock className="w-5 h-5 text-blue-600" />
                  <div>
                    <p className="text-[#111827]">In Review</p>
                    <p className="text-[#6B7280] text-sm">Awaiting approval</p>
                  </div>
                </div>
                <p className="text-2xl text-blue-600">{stats.inReview}</p>
              </div>

              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-gray-50 to-slate-50 rounded-xl border border-gray-200">
                <div className="flex items-center gap-3">
                  <Package className="w-5 h-5 text-gray-600" />
                  <div>
                    <p className="text-[#111827]">Drafts</p>
                    <p className="text-[#6B7280] text-sm">Work in progress</p>
                  </div>
                </div>
                <p className="text-2xl text-gray-600">{stats.drafts}</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Revenue Breakdown & Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 p-6 border border-gray-200 hover:shadow-md transition-shadow">
            <h2 className="text-[#111827] mb-4">Revenue Breakdown</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl">
                <div>
                  <p className="text-[#6B7280] text-sm">Gross Revenue</p>
                  <p className="text-2xl text-[#111827]">{formatCurrency(metrics.totalRevenue)}</p>
                </div>
                <TrendingUp className="w-8 h-8 text-blue-600" />
              </div>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                  <p className="text-[#6B7280] text-sm mb-1">Platform Fee ({metrics.platformCommissionRate}%)</p>
                  <p className="text-xl text-red-600">-{formatCurrency(metrics.platformFees)}</p>
                </div>
                <div className="p-4 bg-orange-50 rounded-xl border border-orange-100">
                  <p className="text-[#6B7280] text-sm mb-1">Curator Commission</p>
                  <p className="text-xl text-orange-600">-{formatCurrency(metrics.curatorCommissions)}</p>
                </div>
              </div>
              
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border-2 border-green-200">
                <div>
                  <p className="text-[#6B7280] text-sm">Your Net Revenue</p>
                  <p className="text-3xl text-green-600">{formatCurrency(metrics.netRevenue)}</p>
                </div>
                <CheckCircle className="w-8 h-8 text-green-600" />
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-gray-200 hover:shadow-md transition-shadow">
            <h2 className="text-[#111827] mb-4">Sales Summary</h2>
            <div className="space-y-4">
              <div>
                <p className="text-[#6B7280] text-sm">Total Orders</p>
                <p className="text-3xl text-[#111827]">{stats.totalPurchases}</p>
              </div>
              <div className="pt-3 border-t border-gray-200">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[#6B7280] text-sm">Redeemed</p>
                  <p className="text-xl text-green-600">{stats.redeemedCount}</p>
                </div>
                <div className="flex items-center justify-between">
                  <p className="text-[#6B7280] text-sm">Pending</p>
                  <p className="text-xl text-yellow-600">{stats.pendingCount}</p>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full mt-4"
                onClick={() => onNavigate('sales')}
              >
                View All Sales
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </BusinessPageLayout>
  );
}