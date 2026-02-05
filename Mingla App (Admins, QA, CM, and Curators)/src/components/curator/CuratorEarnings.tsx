import React, { useState } from 'react';
import { 
  DollarSign, TrendingUp, Download, Calendar, 
  ArrowUpRight, ArrowDownRight, CreditCard, Building2,
  Eye, Target, Percent, Users
} from 'lucide-react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import CuratorPageLayout from './CuratorPageLayout';

interface CuratorEarningsProps {
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
  businesses: any[];
}

export default function CuratorEarnings({ earningsData, businesses }: CuratorEarningsProps) {
  const [timeframe, setTimeframe] = useState('30d');

  const transactions = [
    {
      id: 1,
      type: 'commission',
      business: 'The Blue Note SF',
      amount: 125.50,
      date: '2025-10-20',
      status: 'completed',
      experience: 'Jazz Night Experience'
    },
    {
      id: 2,
      type: 'commission',
      business: 'Artisan Chocolate Co',
      amount: 89.00,
      date: '2025-10-18',
      status: 'completed',
      experience: 'Chocolate Workshop'
    },
    {
      id: 3,
      type: 'commission',
      business: 'Golden Gate Wellness',
      amount: 45.25,
      date: '2025-10-15',
      status: 'pending',
      experience: 'Morning Yoga Session'
    },
    {
      id: 4,
      type: 'payout',
      business: 'Platform Payout',
      amount: -3200.00,
      date: '2025-10-01',
      status: 'completed',
      experience: 'Monthly Payout'
    },
    {
      id: 5,
      type: 'commission',
      business: 'Rooftop Wine Bar',
      amount: 165.75,
      date: '2025-09-28',
      status: 'completed',
      experience: 'Wine Tasting Event'
    }
  ];

  return (
    <CuratorPageLayout
      title="Earnings"
      description="Track your income and commission from experiences"
      actions={
        <div className="flex gap-2">
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="w-[140px]">
              <Calendar className="w-4 h-4 mr-2" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="90d">Last 90 days</SelectItem>
              <SelectItem value="all">All time</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline">
            <Download className="w-4 h-4 mr-2" />
            Export
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Key Metrics */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#6B7280] text-sm">Total Earned</p>
                <p className="text-[#111827] text-3xl mt-2">${earningsData.totalEarned.toLocaleString()}</p>
                <p className="text-[#10B981] text-sm mt-2 flex items-center gap-1">
                  <ArrowUpRight className="w-4 h-4" />
                  All time
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
                <p className="text-[#6B7280] text-sm">Pending Payout</p>
                <p className="text-[#111827] text-3xl mt-2">${earningsData.pendingPayout.toLocaleString()}</p>
                <p className="text-[#6B7280] text-sm mt-2">Next payout Nov 1</p>
              </div>
              <div className="p-3 bg-gradient-to-br from-blue-50 to-indigo-50 rounded-xl">
                <CreditCard className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#6B7280] text-sm">This Month</p>
                <p className="text-[#111827] text-3xl mt-2">${earningsData.thisMonth.toLocaleString()}</p>
                <p className="text-[#10B981] text-sm mt-2 flex items-center gap-1">
                  <ArrowUpRight className="w-4 h-4" />
                  +24% vs last month
                </p>
              </div>
              <div className="p-3 bg-gradient-to-br from-[#eb7825]/10 to-[#d6691f]/10 rounded-xl">
                <TrendingUp className="w-6 h-6 text-[#eb7825]" />
              </div>
            </div>
          </Card>

          <Card className="p-6 border border-gray-200 hover:shadow-lg transition-shadow">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-[#6B7280] text-sm">Commission Rate</p>
                <p className="text-[#111827] text-3xl mt-2">{earningsData.commissionRate}%</p>
                <p className="text-[#6B7280] text-sm mt-2">{earningsData.totalSales} sales</p>
              </div>
              <div className="p-3 bg-gradient-to-br from-purple-50 to-pink-50 rounded-xl">
                <Percent className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </Card>
        </div>

        {/* Earnings Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="lg:col-span-2 p-6 border border-gray-200">
            <h2 className="text-[#111827] mb-4">Recent Transactions</h2>
            <div className="space-y-3">
              {transactions.map(transaction => (
                <div 
                  key={transaction.id}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 p-4 rounded-xl border border-gray-200 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3 sm:gap-4 min-w-0 flex-1">
                    <div className={`p-2 sm:p-3 rounded-xl flex-shrink-0 ${
                      transaction.type === 'payout' 
                        ? 'bg-blue-50' 
                        : transaction.status === 'completed'
                        ? 'bg-green-50'
                        : 'bg-yellow-50'
                    }`}>
                      {transaction.type === 'payout' ? (
                        <CreditCard className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
                      ) : (
                        <DollarSign className={`w-4 h-4 sm:w-5 sm:h-5 ${
                          transaction.status === 'completed' ? 'text-green-600' : 'text-yellow-600'
                        }`} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[#111827] truncate">{transaction.experience}</p>
                      <p className="text-[#6B7280] text-sm truncate">{transaction.business}</p>
                      <p className="text-[#6B7280] text-xs mt-1">
                        {new Date(transaction.date).toLocaleDateString('en-US', { 
                          month: 'short', 
                          day: 'numeric', 
                          year: 'numeric' 
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center justify-between sm:justify-end sm:text-right gap-3 flex-shrink-0">
                    <p className={`text-lg ${
                      transaction.amount > 0 ? 'text-green-600' : 'text-blue-600'
                    }`}>
                      {transaction.amount > 0 ? '+' : ''}${Math.abs(transaction.amount).toFixed(2)}
                    </p>
                    <Badge 
                      className={
                        transaction.status === 'completed'
                          ? 'bg-green-100 text-green-700 border-green-200'
                          : 'bg-yellow-100 text-yellow-700 border-yellow-200'
                      }
                    >
                      {transaction.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <div className="space-y-6">
            <Card className="p-6 border border-gray-200">
              <h2 className="text-[#111827] mb-4">Earnings by Business</h2>
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-gray-600" />
                    <span className="text-[#111827] text-sm">The Blue Note SF</span>
                  </div>
                  <span className="text-[#111827]">$1,245</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-gray-600" />
                    <span className="text-[#111827] text-sm">Artisan Chocolate</span>
                  </div>
                  <span className="text-[#111827]">$890</span>
                </div>
                <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-gray-600" />
                    <span className="text-[#111827] text-sm">Rooftop Wine Bar</span>
                  </div>
                  <span className="text-[#111827]">$760</span>
                </div>
              </div>
            </Card>

            <Card className="p-6 border border-gray-200">
              <h2 className="text-[#111827] mb-4">Performance</h2>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-[#6B7280]">Active Businesses</span>
                    <span className="text-[#111827]">{businesses.length}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-gradient-to-r from-[#eb7825] to-[#d6691f] h-2 rounded-full" style={{ width: '75%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-[#6B7280]">Total Sales</span>
                    <span className="text-[#111827]">{earningsData.totalSales}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-gradient-to-r from-green-500 to-emerald-600 h-2 rounded-full" style={{ width: '60%' }}></div>
                  </div>
                </div>
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-[#6B7280]">Conversion Rate</span>
                    <span className="text-[#111827]">2.8%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-gradient-to-r from-blue-500 to-indigo-600 h-2 rounded-full" style={{ width: '45%' }}></div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Payout Information */}
        <Card className="p-4 sm:p-6 border border-gray-200">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div className="flex-1 min-w-0">
              <h2 className="text-[#111827] mb-2">Payout Information</h2>
              <p className="text-[#6B7280] text-sm mb-4">
                Your earnings are paid out monthly on the 1st of each month. Your next payout of ${earningsData.pendingPayout.toLocaleString()} is scheduled for November 1, 2025.
              </p>
              <div className="flex flex-col sm:flex-row gap-4 sm:gap-6 text-sm">
                <div className="flex-1 min-w-0">
                  <p className="text-[#6B7280] mb-1">Last Payout</p>
                  <p className="text-[#111827]">${earningsData.lastPayout.toLocaleString()}</p>
                  <p className="text-[#6B7280] text-xs">{new Date(earningsData.lastPayoutDate).toLocaleDateString()}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[#6B7280] mb-1">Payment Method</p>
                  <p className="text-[#111827]">Bank Account</p>
                  <p className="text-[#6B7280] text-xs">••••4242</p>
                </div>
              </div>
            </div>
            <Button variant="outline" className="w-full sm:w-auto sm:flex-shrink-0 whitespace-nowrap">
              Manage Payout Settings
            </Button>
          </div>
        </Card>
      </div>
    </CuratorPageLayout>
  );
}
