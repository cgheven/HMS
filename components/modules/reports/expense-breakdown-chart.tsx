"use client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useMoney } from "@/contexts/hostel-context";
import type { RevenueMonth } from "@/types";

function CustomTooltip({ active, payload, label, money }: { active?: boolean; payload?: { name: string; value: number; fill: string }[]; label?: string; money?: (n: number) => string }) {
  if (!active || !payload?.length) return null;
  const fmt = money ?? ((n: number) => String(n));
  const total = payload.reduce((s, p) => s + p.value, 0);
  return (
    <div className="rounded-xl border border-sidebar-border bg-card px-3 py-2.5 shadow-xl text-xs">
      <p className="font-semibold text-foreground mb-1.5">{label}</p>
      {payload.map((p) => p.value > 0 && (
        <div key={p.name} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: p.fill }} />
          <span className="text-muted-foreground">{p.name}:</span>
          <span className="font-medium text-foreground">{fmt(p.value)}</span>
        </div>
      ))}
      <div className="border-t border-sidebar-border mt-1.5 pt-1.5 flex justify-between">
        <span className="text-muted-foreground">Total:</span>
        <span className="font-bold text-foreground">{fmt(total)}</span>
      </div>
    </div>
  );
}

export function ExpenseBreakdownChart({ data }: { data: RevenueMonth[] }) {
  const money = useMoney();
  const chartData = data.map((m) => ({
    month: m.month,
    Kitchen: m.kitchen,
    Expenses: Math.max(0, m.expenses - m.kitchen - m.salaries),
    Salaries: m.salaries,
  }));

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={chartData} margin={{ top: 5, right: 4, left: 0, bottom: 0 }} barSize={20}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(213 30% 16%)" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(220 18% 50%)" }} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 11, fill: "hsl(220 18% 50%)" }} axisLine={false} tickLine={false} width={52} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
        <Tooltip content={<CustomTooltip money={money} />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Bar dataKey="Expenses"  stackId="a" fill="#f43f5e" fillOpacity={0.8} radius={[0, 0, 0, 0]} />
        <Bar dataKey="Kitchen"   stackId="a" fill="#f5a623" fillOpacity={0.8} radius={[0, 0, 0, 0]} />
        <Bar dataKey="Salaries"  stackId="a" fill="#a855f7" fillOpacity={0.8} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
