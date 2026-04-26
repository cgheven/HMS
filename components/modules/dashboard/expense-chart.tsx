"use client";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { formatCurrency } from "@/lib/utils";

interface Props {
  data: { month: string; expenses: number; kitchen: number; collected: number }[];
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-sidebar-border bg-card px-3 py-2.5 shadow-xl text-xs">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium text-foreground">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function ExpenseChart({ data }: Props) {
  const enriched = data.map((d) => ({ ...d, totalSpend: d.expenses + d.kitchen }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={enriched} margin={{ top: 5, right: 4, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="spendGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#f43f5e" stopOpacity={0.2} />
            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(213 30% 16%)" />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(220 18% 50%)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "hsl(220 18% 50%)" }} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
        <Tooltip content={<CustomTooltip />} />
        <Area type="monotone" dataKey="collected"  name="Revenue"     stroke="#10b981" fill="url(#revGrad)"   strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: "#10b981" }} />
        <Area type="monotone" dataKey="totalSpend" name="Total Spend" stroke="#f43f5e" fill="url(#spendGrad)" strokeWidth={2}   dot={false} activeDot={{ r: 4, fill: "#f43f5e" }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
