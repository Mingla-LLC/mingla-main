import React from 'react';
import { 
  TrendingUp, FileText, Building2, DollarSign, Eye, Heart, 
  BarChart3, ArrowUpRight, ArrowDownRight, Plus, MessageCircle,
  Clock, CheckCircle, Users, Target, Zap
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import CuratorPageLayout from './CuratorPageLayout';

interface CuratorOverviewProps {
  userData?: any;
  onNavigate: (tab: string) => void;
  onOpenCreateCard: () => void;
  stats: {
    totalCards: number;
    liveCards: number;
    inReview: number;
    drafts: number;
    totalViews: number;
    totalLikes: number;
  };
  earningsData: {
    totalEarned: number;
    pendingPayout: number;
    thisMonth: number;
    lastPayout: number;
    lastPayoutDate: string;
    commissionRate: number;
    activeBusinesses: number;
    totalSales: number;
  };
  analyticsData: any;
  businesses: any[];
}

export default function CuratorOverview({ 
  userData, 
  onNavigate, 
  onOpenCreateCard,
  stats,
  earningsData,
  analyticsData,
  businesses
}: CuratorOverviewProps) {
  return (
    <CuratorPageLayout
      title={`Welcome back, ${userData?.name || 'Curator'}!`}
      description="Here's what's happening with your curated experiences"
      actions={
        <Button 
          onClick={onOpenCreateCard}
          className="bg-[#eb7825] hover:bg-[#d6691f] text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Create Card
        </Button>
      }
    >
      <div className="space-y-4">
        {/* Quick Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="p-6 border border-gray-200 hover:shadow-lg transition-shadow">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[#6B7280] text-sm">Total Cards</p>
              <p className="text-[#111827] text-3xl mt-2">{stats.totalCards}</p>
              <p className="text-[#10B981] text-sm mt-2 flex items-center gap-1">
                <ArrowUpRight className="w-4 h-4" />
                {stats.liveCards} live
              </p>
            </div>
            <div className="p-3 bg-gradient-to-br from-[#eb7825]/10 to-[#d6691f]/10 rounded-xl">
              <FileText className="w-6 h-6 text-[#eb7825]" />
            </div>
          </div>
        </Card>

        <Card className="p-6 border border-gray-200 hover:shadow-lg transition-shadow">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[#6B7280] text-sm">Total Views</p>
              <p className="text-[#111827] text-3xl mt-2">{stats.totalViews.toLocaleString()}</p>
              <p className="text-[#10B981] text-sm mt-2 flex items-center gap-1">
                <ArrowUpRight className="w-4 h-4" />
                {analyticsData.viewsGrowth}% this month
              </p>
            </div>
            <div className="p-3 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl">
              <Eye className="w-6 h-6 text-blue-600" />
            </div>
          </div>
        </Card>

        <Card className="p-6 border border-gray-200 hover:shadow-lg transition-shadow">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-[#6B7280] text-sm">Monthly Earnings</p>
              <p className="text-[#111827] text-3xl mt-2">${earningsData.thisMonth.toLocaleString()}</p>
              <p className="text-[#10B981] text-sm mt-2 flex items-center gap-1">
                <ArrowUpRight className="w-4 h-4" />
                {earningsData.commissionRate}% commission
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
              <p className="text-[#6B7280] text-sm">Active Businesses</p>
              <p className="text-[#111827] text-3xl mt-2">{businesses.length}</p>
              <p className="text-[#6B7280] text-sm mt-2 flex items-center gap-1">
                <Target className="w-4 h-4" />
                {earningsData.totalSales} sales
              </p>
            </div>
            <div className="p-3 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl">
              <Building2 className="w-6 h-6 text-purple-600" />
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
              onClick={() => onNavigate('businesses')}
            >
              <div className="p-1.5 sm:p-2 bg-purple-50 rounded-lg flex-shrink-0">
                <Building2 className="w-4 h-4 sm:w-5 sm:h-5 text-purple-600" />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-[#111827] truncate">Manage Businesses</p>
                <p className="text-[#6B7280] text-xs sm:text-sm truncate">View and manage collaborations</p>
              </div>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start gap-2 sm:gap-3 h-auto py-3 sm:py-4 px-3 sm:px-4"
              onClick={() => onNavigate('messages')}
            >
              <div className="p-1.5 sm:p-2 bg-blue-50 rounded-lg flex-shrink-0">
                <MessageCircle className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-[#111827] truncate">View Messages</p>
                <p className="text-[#6B7280] text-xs sm:text-sm truncate">Chat with business partners</p>
              </div>
            </Button>

            <Button
              variant="outline"
              className="w-full justify-start gap-2 sm:gap-3 h-auto py-3 sm:py-4 px-3 sm:px-4"
              onClick={() => onNavigate('analytics')}
            >
              <div className="p-1.5 sm:p-2 bg-green-50 rounded-lg flex-shrink-0">
                <BarChart3 className="w-4 h-4 sm:w-5 sm:h-5 text-green-600" />
              </div>
              <div className="flex-1 text-left min-w-0">
                <p className="text-[#111827] truncate">View Analytics</p>
                <p className="text-[#6B7280] text-xs sm:text-sm truncate">Track performance metrics</p>
              </div>
            </Button>
          </div>
        </Card>

        {/* Card Status Overview */}
        <Card className="p-6 border border-gray-200 hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-[#111827]">Card Status</h2>
            <Button 
              variant="ghost" 
              size="sm"
              onClick={() => onNavigate('cards')}
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
              <p className="text-2xl text-emerald-600">{stats.liveCards}</p>
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
                <FileText className="w-5 h-5 text-gray-600" />
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

        {/* Recent Activity & Performance */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 p-6 border border-gray-200 hover:shadow-md transition-shadow">
          <h2 className="text-[#111827] mb-4">Performance Highlights</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-gray-50 rounded-xl">
              <Eye className="w-6 h-6 text-blue-600 mx-auto mb-2" />
              <p className="text-2xl text-[#111827]">{stats.totalViews}</p>
              <p className="text-[#6B7280] text-sm">Total Views</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-xl">
              <Heart className="w-6 h-6 text-red-500 mx-auto mb-2" />
              <p className="text-2xl text-[#111827]">{stats.totalLikes}</p>
              <p className="text-[#6B7280] text-sm">Total Likes</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-xl">
              <Users className="w-6 h-6 text-purple-600 mx-auto mb-2" />
              <p className="text-2xl text-[#111827]">{analyticsData.engagementRate}%</p>
              <p className="text-[#6B7280] text-sm">Engagement</p>
            </div>
            <div className="text-center p-4 bg-gray-50 rounded-xl">
              <Zap className="w-6 h-6 text-yellow-600 mx-auto mb-2" />
              <p className="text-2xl text-[#111827]">{analyticsData.conversionRate}%</p>
              <p className="text-[#6B7280] text-sm">Conversion</p>
            </div>
          </div>
        </Card>

        <Card className="p-6 border border-gray-200 hover:shadow-md transition-shadow">
          <h2 className="text-[#111827] mb-4">Earnings Summary</h2>
          <div className="space-y-3">
            <div>
              <p className="text-[#6B7280] text-sm">Total Earned</p>
              <p className="text-2xl text-[#111827]">${earningsData.totalEarned.toLocaleString()}</p>
            </div>
            <div className="pt-3 border-t border-gray-200">
              <p className="text-[#6B7280] text-sm">Pending Payout</p>
              <p className="text-xl text-green-600">${earningsData.pendingPayout.toLocaleString()}</p>
            </div>
            <Button
              variant="outline"
              className="w-full mt-4"
              onClick={() => onNavigate('earnings')}
            >
              View Earnings Details
            </Button>
          </div>
        </Card>
        </div>
      </div>
    </CuratorPageLayout>
  );
}
