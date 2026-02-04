import React, { useState } from 'react';
import { 
  TrendingUp, Eye, Heart, Bookmark, Users, Target,
  ArrowUpRight, ArrowDownRight, Calendar, Download,
  BarChart3, PieChart, LineChart, Zap, ShoppingCart, DollarSign
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import BusinessPageLayout from './BusinessPageLayout';

interface BusinessAnalyticsProps {
  experiences: any[];
  purchases: any[];
  formatCurrency: (amount: number) => string;
}

export default function BusinessAnalytics({ experiences, purchases, formatCurrency }: BusinessAnalyticsProps) {
  const [timeframe, setTimeframe] = useState('30d');

  // Calculate analytics
  const stats = {
    totalViews: experiences.reduce((sum, exp) => sum + (exp.views || 0), 0),
    totalLikes: experiences.reduce((sum, exp) => sum + (exp.likes || 0), 0),
    totalSaves: experiences.reduce((sum, exp) => sum + (exp.saves || 0), 0),
    totalPurchases: purchases.length,
    totalRevenue: purchases.reduce((sum, p) => sum + p.amount, 0),
    liveExperiences: experiences.filter(e => e.status === 'live').length,
  };

  const analyticsData = {
    viewsGrowth: 24,
    engagementRate: stats.totalViews > 0 ? ((stats.totalLikes + stats.totalSaves) / stats.totalViews * 100).toFixed(1) : 0,
    conversionRate: stats.totalViews > 0 ? (stats.totalPurchases / stats.totalViews * 100).toFixed(1) : 0,
    avgTimeOnCard: '2m 34s',
    avgOrderValue: stats.totalPurchases > 0 ? stats.totalRevenue / stats.totalPurchases : 0,
    topExperience: experiences.sort((a, b) => (b.views || 0) - (a.views || 0))[0],
    chartData: [
      { name: 'Mon', views: 120, sales: 8, saves: 15 },
      { name: 'Tue', views: 150, sales: 12, saves: 18 },
      { name: 'Wed', views: 180, sales: 14, saves: 22 },
      { name: 'Thu', views: 200, sales: 18, saves: 25 },
      { name: 'Fri', views: 280, sales: 24, saves: 35 },
      { name: 'Sat', views: 350, sales: 32, saves: 42 },
      { name: 'Sun', views: 300, sales: 28, saves: 38 },
    ]
  };

  const exportReport = () => {
    const reportData = {
      'Total Views': stats.totalViews,
      'Total Likes': stats.totalLikes,
      'Total Saves': stats.totalSaves,
      'Total Purchases': stats.totalPurchases,
      'Total Revenue': formatCurrency(stats.totalRevenue),
      'Engagement Rate': `${analyticsData.engagementRate}%`,
      'Conversion Rate': `${analyticsData.conversionRate}%`,
      'Avg Order Value': formatCurrency(analyticsData.avgOrderValue),
    };
    
    const csv = Object.entries(reportData).map(([key, value]) => `${key},${value}`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `analytics-report-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <BusinessPageLayout
      title="Analytics"
      description="Track performance and insights for your experiences"
      actions={
        <div className="flex flex-col sm:flex-row gap-2">
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="w-full sm:w-[140px] backdrop-blur-xl bg-white/80 border-white/20 shadow-lg transition-all duration-300 hover:bg-white/90">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="backdrop-blur-xl bg-white/95 border-white/20">
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <Button 
            variant="outline" 
            onClick={exportReport}
            className="backdrop-blur-xl bg-white/80 border-white/20 shadow-lg transition-all duration-300 hover:bg-white/90 hover:scale-[1.02] active:scale-[0.98]"
          >
            <Download className="w-4 h-4 mr-2" />
            Export Report
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Key Metrics */}
        <div className="h-full flex flex-col gap-2 pb-16">
          {/* Revenue - Full width featured card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <Card className="p-2 backdrop-blur-xl bg-white/80 border-white/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.01] flex-shrink-0 relative overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-br from-[#eb7825]/5 to-[#d6691f]/5 opacity-0 hover:opacity-100 transition-opacity duration-300" />
              <div className="relative">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-[#6B7280] text-xs">Revenue</p>
                    <p className="text-[#111827] text-4xl mt-0.5 font-medium w-full">{formatCurrency(stats.totalRevenue)}</p>
                    <p className="text-[#10B981] text-xs mt-0.5 flex items-center gap-1">
                      <motion.div
                        animate={{ y: [-1, 1, -1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      >
                        <ArrowUpRight className="w-3 h-3" />
                      </motion.div>
                      +12% growth
                    </p>
                  </div>
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  <motion.div 
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    className="bg-gradient-to-br from-blue-50/80 to-indigo-50/80 backdrop-blur-xl border border-white/40 rounded-lg p-1.5 shadow-sm"
                  >
                    <p className="text-[#6B7280] text-xs">Avg Order</p>
                    <p className="text-[#111827] text-lg font-medium">{formatCurrency(analyticsData.avgOrderValue)}</p>
                  </motion.div>
                  <motion.div 
                    whileHover={{ scale: 1.02 }}
                    transition={{ type: "spring", stiffness: 400, damping: 25 }}
                    className="bg-gradient-to-br from-purple-50/80 to-pink-50/80 backdrop-blur-xl border border-white/40 rounded-lg p-1.5 shadow-sm"
                  >
                    <p className="text-[#6B7280] text-xs">Orders</p>
                    <p className="text-[#111827] text-lg font-medium">{stats.totalPurchases}</p>
                  </motion.div>
                </div>
              </div>
            </Card>
          </motion.div>

          {/* Full width metric cards - Equal heights */}
          <div className="flex-1 flex flex-col gap-2">
            {/* Total Views */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <Card className="flex-1 p-2 backdrop-blur-xl bg-white/80 border-white/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.01] relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-indigo-500/5 opacity-0 hover:opacity-100 transition-opacity duration-300" />
                <div className="relative flex items-start justify-between h-full">
                  <div>
                    <p className="text-[#6B7280] text-xs">Total Views</p>
                    <p className="text-[#111827] text-xl mt-0.5 font-medium">{stats.totalViews.toLocaleString()}</p>
                    <p className="text-[#10B981] text-xs mt-0.5 flex items-center gap-1">
                      <motion.div
                        animate={{ y: [-1, 1, -1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      >
                        <ArrowUpRight className="w-3 h-3" />
                      </motion.div>
                      +{analyticsData.viewsGrowth}%
                    </p>
                  </div>
                  <motion.div 
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="p-1.5 bg-gradient-to-br from-blue-50 to-indigo-50 backdrop-blur-xl border border-white/40 rounded-lg shadow-sm"
                  >
                    <Eye className="w-4 h-4 text-blue-600" />
                  </motion.div>
                </div>
              </Card>
            </motion.div>

            {/* Total Cards */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <Card className="flex-1 p-2 backdrop-blur-xl bg-white/80 border-white/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.01] relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 opacity-0 hover:opacity-100 transition-opacity duration-300" />
                <div className="relative flex items-start justify-between h-full">
                  <div>
                    <p className="text-[#6B7280] text-xs">Total Cards</p>
                    <p className="text-[#111827] text-xl mt-0.5 font-medium">{experiences.length}</p>
                    <p className="text-[#6B7280] text-xs mt-0.5 flex items-center gap-1">
                      <Zap className="w-3 h-3" />
                      {stats.liveExperiences} live
                    </p>
                  </div>
                  <motion.div 
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="p-1.5 bg-gradient-to-br from-purple-50 to-pink-50 backdrop-blur-xl border border-white/40 rounded-lg shadow-sm"
                  >
                    <BarChart3 className="w-4 h-4 text-purple-600" />
                  </motion.div>
                </div>
              </Card>
            </motion.div>

            {/* Conversion Rate */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <Card className="flex-1 p-2 backdrop-blur-xl bg-white/80 border-white/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.01] relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-green-500/5 to-emerald-500/5 opacity-0 hover:opacity-100 transition-opacity duration-300" />
                <div className="relative flex items-start justify-between h-full">
                  <div>
                    <p className="text-[#6B7280] text-xs">Conversion</p>
                    <p className="text-[#111827] text-xl mt-0.5 font-medium">{analyticsData.conversionRate}%</p>
                    <p className="text-[#6B7280] text-xs mt-0.5 flex items-center gap-1">
                      <Target className="w-3 h-3" />
                      Steady
                    </p>
                  </div>
                  <motion.div 
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="p-1.5 bg-gradient-to-br from-green-50 to-emerald-50 backdrop-blur-xl border border-white/40 rounded-lg shadow-sm"
                  >
                    <Target className="w-4 h-4 text-green-600" />
                  </motion.div>
                </div>
              </Card>
            </motion.div>

            {/* Total Customers */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <Card className="flex-1 p-2 backdrop-blur-xl bg-white/80 border-white/20 shadow-lg hover:shadow-xl transition-all duration-300 hover:scale-[1.01] relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 to-pink-500/5 opacity-0 hover:opacity-100 transition-opacity duration-300" />
                <div className="relative flex items-start justify-between h-full">
                  <div>
                    <p className="text-[#6B7280] text-xs">Customers</p>
                    <p className="text-[#111827] text-xl mt-0.5 font-medium">{new Set(purchases.map(p => p.userId)).size}</p>
                    <p className="text-[#10B981] text-xs mt-0.5 flex items-center gap-1">
                      <motion.div
                        animate={{ y: [-1, 1, -1] }}
                        transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                      >
                        <ArrowUpRight className="w-3 h-3" />
                      </motion.div>
                      Active
                    </p>
                  </div>
                  <motion.div 
                    whileHover={{ scale: 1.1, rotate: 5 }}
                    transition={{ type: "spring", stiffness: 300, damping: 20 }}
                    className="p-1.5 bg-gradient-to-br from-purple-50 to-pink-50 backdrop-blur-xl border border-white/40 rounded-lg shadow-sm"
                  >
                    <Users className="w-4 h-4 text-purple-600" />
                  </motion.div>
                </div>
              </Card>
            </motion.div>
          </div>
        </div>

        {/* Insights */}
        {/* Removed insights section */}
      </div>
    </BusinessPageLayout>
  );
}