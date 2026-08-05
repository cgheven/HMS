"use client";

import { useMemo, useState } from "react";
import { GraduationCap, Search, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { STUDENT_CATEGORY_LABELS } from "@/lib/student-category-labels";
import { formatDate, cn } from "@/lib/utils";
import type { StudentRow } from "@/app/actions/students";
import type { StudentCategory } from "@/types";

const TYPE_CONFIG: Record<string, { label: string; cls: string }> = {
  student:      { label: "Student",      cls: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  professional: { label: "Professional", cls: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  general:      { label: "General",      cls: "bg-white/5 text-muted-foreground border-white/10" },
};

const ALL = "all";

function categoryLabel(c: string | null): string | null {
  if (!c) return null;
  return STUDENT_CATEGORY_LABELS[c as StudentCategory] ?? c;
}

/** Institute for a student, employer for a professional — the same column answers
 *  "where are they from" for both, so one column serves the whole list. */
function affiliationOf(s: StudentRow): string | null {
  return s.institute_name || s.organization || null;
}

/** Department for university/college, specialization for the preset-driven
 *  categories (exam prep, skills training) — only one is ever populated. */
function fieldOf(s: StudentRow): string | null {
  return s.department || s.student_specialization || null;
}

function uniqueSorted(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v && v.trim() !== ""))].sort((a, b) =>
    a.localeCompare(b)
  );
}

interface Props {
  students: StudentRow[];
}

export function SuperAdminStudentsClient({ students }: Props) {
  const [search, setSearch] = useState("");
  const [hostel, setHostel] = useState(ALL);
  const [type, setType] = useState(ALL);
  const [institute, setInstitute] = useState(ALL);
  const [field, setField] = useState(ALL);
  const [category, setCategory] = useState(ALL);

  const hostels = useMemo(
    () => uniqueSorted(students.map((s) => s.hostel_name)),
    [students]
  );
  const institutes = useMemo(() => uniqueSorted(students.map(affiliationOf)), [students]);
  const fields = useMemo(() => uniqueSorted(students.map(fieldOf)), [students]);
  const categories = useMemo(
    () => uniqueSorted(students.map((s) => s.student_category)),
    [students]
  );

  const filtered = useMemo(() => {
    let list = students;
    if (hostel !== ALL) list = list.filter((s) => s.hostel_name === hostel);
    if (type !== ALL) list = list.filter((s) => s.type === type);
    if (institute !== ALL) list = list.filter((s) => affiliationOf(s) === institute);
    if (field !== ALL) list = list.filter((s) => fieldOf(s) === field);
    if (category !== ALL) list = list.filter((s) => s.student_category === category);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.full_name.toLowerCase().includes(q) ||
          s.phone.toLowerCase().includes(q) ||
          (affiliationOf(s) ?? "").toLowerCase().includes(q) ||
          (fieldOf(s) ?? "").toLowerCase().includes(q) ||
          s.hostel_name.toLowerCase().includes(q) ||
          (s.city ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [students, search, hostel, type, institute, field, category]);

  const filtersActive =
    search.trim() !== "" || [hostel, type, institute, field, category].some((v) => v !== ALL);

  function clearFilters() {
    setSearch("");
    setHostel(ALL);
    setType(ALL);
    setInstitute(ALL);
    setField(ALL);
    setCategory(ALL);
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-sidebar-border px-4 sm:px-6 h-14 flex items-center">
        <div className="flex items-center gap-3 max-w-7xl mx-auto w-full">
          <div className="p-2 rounded-lg bg-amber/10 border border-amber/20">
            <GraduationCap className="w-4 h-4 text-amber" />
          </div>
          <div>
            <h1 className="text-base font-bold">Students</h1>
            <p className="text-xs text-muted-foreground">
              Everyone living across every client hostel
            </p>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl space-y-5">
        <div className="flex flex-col lg:flex-row gap-3 lg:items-center">
          <div className="relative w-full lg:max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search name, phone, institute, hostel..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex gap-2 flex-1">
            <Select value={hostel} onValueChange={setHostel}>
              <SelectTrigger className="h-9 text-xs lg:w-44"><SelectValue placeholder="Hostel" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All hostels</SelectItem>
                {hostels.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="h-9 text-xs lg:w-36"><SelectValue placeholder="Type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All types</SelectItem>
                <SelectItem value="student">Student</SelectItem>
                <SelectItem value="professional">Professional</SelectItem>
                <SelectItem value="general">General</SelectItem>
              </SelectContent>
            </Select>

            <Select value={institute} onValueChange={setInstitute}>
              <SelectTrigger className="h-9 text-xs lg:w-48"><SelectValue placeholder="Institute" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All institutes</SelectItem>
                {institutes.map((i) => <SelectItem key={i} value={i}>{i}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={field} onValueChange={setField}>
              <SelectTrigger className="h-9 text-xs lg:w-44"><SelectValue placeholder="Department" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All departments</SelectItem>
                {fields.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>

            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="h-9 text-xs lg:w-40"><SelectValue placeholder="Category" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c} value={c}>{categoryLabel(c)}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {filtersActive && (
              <button
                onClick={clearFilters}
                className="inline-flex items-center justify-center gap-1.5 h-9 px-3 rounded-md border border-sidebar-border text-xs text-muted-foreground hover:text-foreground hover:bg-white/5 transition-colors"
              >
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>
        </div>

        <Card>
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <p className="text-sm font-semibold">
                {filtered.length}
                <span className="text-muted-foreground font-normal">
                  {filtered.length === students.length ? " residents" : ` of ${students.length} residents`}
                </span>
              </p>
              <p className="text-[11px] text-muted-foreground/60">Test accounts excluded</p>
            </div>

            {filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <GraduationCap className="w-10 h-10 mb-3 opacity-30" />
                <p className="font-medium">No residents match</p>
                <p className="text-sm mt-1">Try widening or clearing the filters</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Name</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Type</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5">Institute / Employer</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5 hidden lg:table-cell">Department</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5 hidden sm:table-cell">Hostel</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-2.5 hidden xl:table-cell">Since</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((s) => {
                      const t = TYPE_CONFIG[s.type] ?? TYPE_CONFIG.general;
                      const affiliation = affiliationOf(s);
                      const fieldValue = fieldOf(s);
                      const cat = categoryLabel(s.student_category);
                      return (
                        <tr key={s.id} className="hover:bg-muted/20 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium truncate max-w-[180px]">{s.full_name}</p>
                            <p className="text-xs text-muted-foreground">{s.phone || "—"}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className={cn("inline-flex px-1.5 py-0.5 rounded border text-[10px] font-semibold whitespace-nowrap", t.cls)}>
                              {t.label}
                            </span>
                            {cat && (
                              <p className="text-[10px] text-muted-foreground/70 mt-1 whitespace-nowrap">{cat}</p>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            {affiliation ? (
                              <span className="text-xs truncate block max-w-[220px]" title={affiliation}>
                                {affiliation}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 hidden lg:table-cell">
                            {fieldValue ? (
                              <span className="text-xs truncate block max-w-[180px]" title={fieldValue}>
                                {fieldValue}
                              </span>
                            ) : (
                              <span className="text-xs text-muted-foreground/40">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 hidden sm:table-cell">
                            <p className="text-xs truncate max-w-[170px]">{s.hostel_name}</p>
                            <p className="text-[10px] text-muted-foreground/70">
                              {[s.city, s.room_number ? `Room ${s.room_number}` : null].filter(Boolean).join(" · ") || "—"}
                            </p>
                          </td>
                          <td className="px-4 py-3 hidden xl:table-cell text-xs text-muted-foreground whitespace-nowrap">
                            {s.check_in ? formatDate(s.check_in) : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
