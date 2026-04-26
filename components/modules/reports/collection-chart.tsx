"use client";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from "recharts";
import type { RevenueMonth } from "@/types";

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-sidebar-border bg-card px-3 py-2 shadow-xl text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      <p className="text-muted-foreground">Collection rate: <span className="font-medium text-foreground">{payload[0].value}%</span></p>
    </div>
  );
}

export function CollectionChart({ data }: { data: RevenueMonth[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(213 30% 16%)" vertical={false} />
        <XAxis dataKey="month" tick={{ fontSize: 11, fill: "hsl(220 18% 50%)" }} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "hsl(220 18% 50%)" }} axisLine={false} tickLine={false} width={36} tickFormatter={(v) => `${v}%`} />
        <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Bar dataKey="collectionRate" name="Collection Rate" radius={[6, 6, 0, 0]}>
          <LabelList dataKey="collectionRate" position="top" style={{ fontSize: 10, fill: "hsl(220 18% 60%)" }} formatter={(v: number) => v > 0 ? `${v}%` : ""} />
          {data.map((entry) => (
            <Cell
              key={entry.monthKey}
              fill={entry.collectionRate >= 80 ? "#10b981" : entry.collectionRate >= 50 ? "#f5a623" : "#f43f5e"}
              fillOpacity={0.7}
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
