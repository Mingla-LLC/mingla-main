import React, { useState } from 'react';
import { 
  DollarSign, TrendingUp, TrendingDown, Calendar, Download,
  ArrowUpRight, CreditCard, Wallet, Target, Percent, PieChart
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../ui/select';
import BusinessPageLayout from './BusinessPageLayout';

interface BusinessEarningsProps {
  metrics: {
    totalRevenue: number;
    platformFees: number;
    platformCommissionRate: number;
    curatorCommissions: number;
    netRevenue: number;
  };
  purchases: any[];
  formatCurrency: (amount: number) => string;
}

export default function BusinessEarnings({ metrics, purchases, formatCurrency }: BusinessEarningsProps) {
  const [dateRange, setDateRange] = useState('30');

  // Calculate monthly earnings trend
  const monthlyEarnings = purchases.reduce((acc: any, purchase) => {
    const month = new Date(purchase.purchaseDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short' });
    if (!acc[month]) {
      acc[month] = { revenue: 0, count: 0 };
    }
    acc[month].revenue += purchase.amount;
    acc[month].count += 1;
    return acc;
  }, {});

  const earningsTrend = Object.entries(monthlyEarnings)
    .map(([month, data]: [string, any]) => ({
      month,
      revenue: data.revenue,
      count: data.count
    }))
    .slice(-6); // Last 6 months

  const exportEarnings = () => {
    const csvData = earningsTrend.map(item => ({
      'Month': item.month,
      'Revenue': item.revenue,
      'Orders': item.count,
      'Average Order Value': item.revenue / item.count
    }));
    
    const headers = Object.keys(csvData[0] || {}).join(',');
    const rows = csvData.map(row => Object.values(row).join(','));
    const csv = [headers, ...rows].join('\n');
    
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `earnings-export-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
  };

  return (
    <BusinessPageLayout
      title="Earnings"
      description="Track your revenue and earnings breakdown"
      actions={
        <div className="flex gap-2">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-[140px]">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
              <SelectItem value="365">Last year</SelectItem>
            </SelectContent>
          </Select>
          <Button 
            onClick={exportEarnings}
            variant="outline"
            className="border-[#eb7825] text-[#eb7825] hover:bg-[#eb7825] hover:text-white"
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        {/* Earnings Overview */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl">
                <DollarSign className="w-6 h-6 text-blue-600" />
              </div>
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-[#6B7280] text-sm mb-1">Gross Revenue</p>
            <p className="text-[#111827] text-3xl mb-2">{formatCurrency(metrics.totalRevenue)}</p>
            <p className="text-green-600 text-sm flex items-center gap-1">
              <ArrowUpRight className="w-4 h-4" />
              Before deductions
            </p>
          </Card>

          <Card className="p-6 border border-green-200 bg-gradient-to-br from-green-50 to-emerald-50">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-white rounded-xl shadow-sm">
                <Wallet className="w-6 h-6 text-green-600" />
              </div>
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-green-700 text-sm mb-1">Net Earnings</p>
            <p className="text-green-900 text-3xl mb-2">{formatCurrency(metrics.netRevenue)}</p>
            <p className="text-green-600 text-sm">After all fees</p>
          </Card>

          <Card className="p-6 border border-[#eb7825]/20 bg-gradient-to-br from-orange-50 to-amber-50">
            <div className="flex items-center justify-between mb-4">
              <div className="p-3 bg-white rounded-xl shadow-sm">
                <Target className="w-6 h-6 text-[#eb7825]" />
              </div>
              <PieChart className="w-5 h-5 text-[#eb7825]" />
            </div>
            <p className="text-[#eb7825] text-sm mb-1">Net Margin</p>
            <p className="text-[#d6691f] text-3xl mb-2">
              {metrics.totalRevenue > 0 ? ((metrics.netRevenue / metrics.totalRevenue) * 100).toFixed(1) : 0}%
            </p>
            <p className="text-[#eb7825] text-sm">Of gross revenue</p>
          </Card>
        </div>

        {/* Detailed Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Revenue Breakdown */}
          <Card className="p-6 border border-gray-200">
            <h2 className="text-[#111827] mb-4">Revenue Breakdown</h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl">
                <div className="flex items-center gap-3">
                  <DollarSign className="w-5 h-5 text-blue-600" />
                  <div>
                    <p className="text-[#111827]">Gross Revenue</p>
                    <p className="text-[#6B7280] text-sm">Total sales amount</p>
                  </div>
                </div>
                <p className="text-[#111827]">{formatCurrency(metrics.totalRevenue)}</p>
              </div>

              <div className="flex items-center justify-between p-4 bg-red-50 rounded-xl border border-red-100">
                <div className="flex items-center gap-3">
                  <TrendingDown className="w-5 h-5 text-red-600" />
                  <div>
                    <p className="text-[#111827]">Platform Fee</p>
                    <p className="text-[#6B7280] text-sm">{metrics.platformCommissionRate}% of revenue</p>
                  </div>
                </div>
                <p className="text-red-600">-{formatCurrency(metrics.platformFees)}</p>
              </div>

              <div className="flex items-center justify-between p-4 bg-orange-50 rounded-xl border border-orange-100">
                <div className="flex items-center gap-3">
                  <Percent className="w-5 h-5 text-orange-600" />
                  <div>
                    <p className="text-[#111827]">Curator Commission</p>
                    <p className="text-[#6B7280] text-sm">Curator earnings</p>
                  </div>
                </div>
                <p className="text-orange-600">-{formatCurrency(metrics.curatorCommissions)}</p>
              </div>

              <div className="flex items-center justify-between p-5 bg-gradient-to-r from-green-50 to-emerald-50 rounded-xl border-2 border-green-200">
                <div className="flex items-center gap-3">
                  <Wallet className="w-6 h-6 text-green-600" />
                  <div>
                    <p className="text-[#111827]">Your Net Earnings</p>
                    <p className="text-green-600 text-sm">Amount you receive</p>
                  </div>
                </div>
                <p className="text-2xl text-green-600">{formatCurrency(metrics.netRevenue)}</p>
              </div>
            </div>
          </Card>

          {/* Monthly Trend */}
          <Card className="p-6 border border-gray-200">
            <h2 className="text-[#111827] mb-4">Monthly Earnings Trend</h2>
            <div className="space-y-3">
              {earningsTrend.length === 0 ? (
                <div className="text-center py-8 text-[#6B7280]">
                  <Calendar className="w-12 h-12 text-gray-300 mx-auto mb-2" />
                  <p>No earnings data yet</p>
                </div>
              ) : (
                earningsTrend.map((item, index) => {
                  const isLatest = index === earningsTrend.length - 1;
                  const prevRevenue = index > 0 ? earningsTrend[index - 1].revenue : item.revenue;
                  const growth = prevRevenue > 0 ? ((item.revenue - prevRevenue) / prevRevenue) * 100 : 0;
                  
                  return (
                    <div 
                      key={item.month}
                      className={`p-4 rounded-xl border transition-all ${
                        isLatest 
                          ? 'bg-gradient-to-r from-[#eb7825]/10 to-[#d6691f]/10 border-[#eb7825]/30' 
                          : 'bg-gray-50 border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <p className="text-[#111827]">{item.month}</p>
                          {isLatest && (
                            <span className="text-xs text-[#eb7825] bg-[#eb7825]/10 px-2 py-0.5 rounded-full">
                              Latest
                            </span>
                          )}
                        </div>
                        {growth !== 0 && (
                          <div className={`flex items-center gap-1 text-sm ${growth > 0 ? 'text-green-600' : 'text-red-600'}`}>
                            {growth > 0 ? <ArrowUpRight className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                            {Math.abs(growth).toFixed(1)}%
                          </div>
                        )}
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-2xl text-[#111827]">{formatCurrency(item.revenue)}</p>
                        <p className="text-[#6B7280] text-sm">{item.count} orders</p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        {/* Key Metrics */}
        <Card className="p-6 border border-gray-200">
          <h2 className="text-[#111827] mb-4">Key Performance Metrics</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl border border-blue-100">
              <p className="text-blue-600 text-sm mb-2">Total Sales</p>
              <p className="text-[#111827] text-2xl">{purchases.length}</p>
            </div>
            <div className="p-4 bg-gradient-to-br from-green-50 to-emerald-50 rounded-xl border border-green-100">
              <p className="text-green-600 text-sm mb-2">Avg. Order Value</p>
              <p className="text-[#111827] text-2xl">
                {formatCurrency(purchases.length > 0 ? metrics.totalRevenue / purchases.length : 0)}
              </p>
            </div>
            <div className="p-4 bg-gradient-to-br from-[#eb7825]/10 to-[#d6691f]/10 rounded-xl border border-[#eb7825]/20">
              <p className="text-[#eb7825] text-sm mb-2">Platform Fee Rate</p>
              <p className="text-[#111827] text-2xl">{metrics.platformCommissionRate}%</p>
            </div>
            <div className="p-4 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl border border-purple-100">
              <p className="text-purple-600 text-sm mb-2">Revenue Retention</p>
              <p className="text-[#111827] text-2xl">
                {metrics.totalRevenue > 0 ? ((metrics.netRevenue / metrics.totalRevenue) * 100).toFixed(0) : 0}%
              </p>
            </div>
          </div>
        </Card>
      </div>
    </BusinessPageLayout>
  );
}
