"use client";
import dynamic from "next/dynamic";

export const ExpenseChartClient = dynamic(
  () => import("./expense-chart").then((m) => m.ExpenseChart),
  { ssr: false, loading: () => <div className="h-[220px] animate-pulse rounded-xl bg-white/5" /> }
);
