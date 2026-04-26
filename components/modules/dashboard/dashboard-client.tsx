"use client";
import {
  BedDouble, Users, TrendingDown, FileWarning,
  ChefHat, Wallet, TrendingUp, AlertCircle,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import type { DashboardStats, Bill } from "@/types";

interface Props {
  data: {
    hostelId: string;
    stats: DashboardStats;
    upcomingBills: Bill[];
    monthlyData: { month: string; expenses: number; kitchen: number }[];
  } | null;
}

export function DashboardClient({ data }: Props) {
  if (!data) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <p>No hostel data found. Complete setup in Settings.</p>
      </div>
    );
  }

  const { stats, upcomingBills, monthlyData } = data;

  const statCards = [
    { label: "Total Rooms", value: stats.total_rooms, icon: BedDouble, color: "text-blue-600", bg: "bg-blue-50" },
    { label: "Occupied", value: stats.occupied_rooms, icon: Users, color: "text-green-600", bg: "bg-green-50", suffix: `/ ${stats.total_rooms}` },
    { label: "Available", value: stats.available_rooms, icon: BedDouble, color: "text-orange-600", bg: "bg-orange-50" },
    { label: "Occupancy", value: `${stats.occupancy_rate}%`, icon: TrendingUp, color: "text-purple-600", bg: "bg-purple-50" },
    { label: "Monthly Expenses", value: formatCurrency(stats.monthly_expenses), icon: TrendingDown, color: "text-red-600", bg: "bg-red-50", small: true },
    { label: "Kitchen Costs", value: formatCurrency(stats.monthly_kitchen), icon: ChefHat, color: "text-amber-600", bg: "bg-amber-50", small: true },
    { label: "Monthly Revenue", value: formatCurrency(stats.monthly_revenue), icon: Wallet, color: "text-emerald-600", bg: "bg-emerald-50", small: true },
    { label: "Unpaid Bills", value: stats.unpaid_bills, icon: FileWarning, color: "text-rose-600", bg: "bg-rose-50", sub: formatCurrency(stats.unpaid_bills_amount) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview of your hostel operations</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {statCards.map(({ label, value, icon: Icon, color, bg, small, suffix, sub }) => (
          <Card key={label} className="border hover:shadow-md transition-shadow">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
                  <p className={`mt-1 font-bold ${small ? "text-lg" : "text-2xl"} truncate`}>
                    {value}
                    {suffix && <span className="text-sm font-normal text-muted-foreground ml-1">{suffix}</span>}
                  </p>
                  {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
                </div>
                <div className={`p-2 rounded-lg ${bg} shrink-0 ml-2`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">6-Month Expense Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={monthlyData} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="expGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="kitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} width={60} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip formatter={(v: number) => formatCurrency(v)} />
                <Legend />
                <Area type="monotone" dataKey="expenses" name="Expenses" stroke="#ef4444" fill="url(#expGrad)" strokeWidth={2} />
                <Area type="monotone" dataKey="kitchen" name="Kitchen" stroke="#f59e0b" fill="url(#kitGrad)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Pending Bills</CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingBills.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-[220px] text-muted-foreground">
                <AlertCircle className="w-8 h-8 mb-2 opacity-40" />
                <p className="text-sm">No pending bills</p>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingBills.map((bill) => (
                  <div key={bill.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/50">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{bill.title}</p>
                      <p className="text-xs text-muted-foreground">Due {formatDate(bill.due_date)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm font-semibold">{formatCurrency(bill.amount)}</p>
                      <Badge variant={bill.status === "overdue" ? "destructive" : "warning"} className="text-xs">
                        {bill.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
