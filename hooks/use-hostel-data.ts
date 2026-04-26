"use client";
import { useHostelContext } from "@/contexts/hostel-context";

export function useHostelData() {
  return useHostelContext();
}
