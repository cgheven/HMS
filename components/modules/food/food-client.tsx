"use client";
import { useState } from "react";
import { Plus, UtensilsCrossed, Edit2, Trash2, ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";
import { formatDate, formatDateInput } from "@/lib/utils";
import type { FoodItem, MealType } from "@/types";

const mealTypes: MealType[] = ["breakfast", "lunch", "dinner", "snack"];
const mealColors: Record<MealType, string> = {
  breakfast: "bg-yellow-50 text-yellow-700 border-yellow-200",
  lunch: "bg-green-50 text-green-700 border-green-200",
  dinner: "bg-blue-50 text-blue-700 border-blue-200",
  snack: "bg-purple-50 text-purple-700 border-purple-200",
};
const mealIcons: Record<MealType, string> = { breakfast: "☀️", lunch: "🌤️", dinner: "🌙", snack: "🍎" };

const emptyForm = { date: formatDateInput(new Date()), meal_type: "lunch" as MealType, item_name: "", quantity: "", unit_cost: "", notes: "" };

interface Props { hostelId: string | null; initialItems: FoodItem[]; initialDate: string; }

export function FoodClient({ hostelId, initialItems, initialDate }: Props) {
  const [items, setItems] = useState<FoodItem[]>(initialItems);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<FoodItem | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [selectedDate, setSelectedDate] = useState(initialDate);

  async function loadDate(date: string) {
    if (!hostelId) return;
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase.from("hms_food_items").select("*").eq("hostel_id", hostelId).eq("date", date).order("meal_type");
    setItems((data as FoodItem[]) ?? []);
    setLoading(false);
  }

  function changeDate(delta: number) {
    const d = new Date(selectedDate);
    d.setDate(d.getDate() + delta);
    const next = formatDateInput(d);
    setSelectedDate(next);
    loadDate(next);
  }

  function goToDate(date: string) {
    setSelectedDate(date);
    loadDate(date);
  }

  async function handleSave() {
    if (!hostelId || !form.item_name) return;
    setSaving(true);
    const supabase = createClient();
    const payload = { hostel_id: hostelId, date: form.date, meal_type: form.meal_type, item_name: form.item_name, quantity: form.quantity || null, unit_cost: form.unit_cost ? parseFloat(form.unit_cost) : null, notes: form.notes || null };
    const { error } = editing ? await supabase.from("hms_food_items").update(payload).eq("id", editing.id) : await supabase.from("hms_food_items").insert(payload);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: editing ? "Updated" : "Added" }); setDialogOpen(false); loadDate(selectedDate); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this item?")) return;
    const supabase = createClient();
    const { error } = await supabase.from("hms_food_items").delete().eq("id", id);
    if (error) toast({ title: "Error", description: error.message, variant: "destructive" });
    else { toast({ title: "Deleted" }); loadDate(selectedDate); }
  }

  const grouped = mealTypes.reduce<Record<MealType, FoodItem[]>>((acc, m) => {
    acc[m] = items.filter((i) => i.meal_type === m);
    return acc;
  }, { breakfast: [], lunch: [], dinner: [], snack: [] });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div><h1 className="text-2xl font-bold tracking-tight">Daily Food List</h1><p className="text-muted-foreground text-sm mt-1">Manage daily meal menus</p></div>
        <Button onClick={() => { setEditing(null); setForm({ ...emptyForm, date: selectedDate }); setDialogOpen(true); }} className="gap-2 w-full sm:w-auto"><Plus className="w-4 h-4" /> Add Item</Button>
      </div>

      <div className="flex items-center gap-3 justify-center sm:justify-start">
        <Button variant="outline" size="icon" onClick={() => changeDate(-1)}><ChevronLeft className="w-4 h-4" /></Button>
        <div className="flex items-center gap-2">
          <Input type="date" value={selectedDate} onChange={(e) => goToDate(e.target.value)} className="w-auto" />
          <span className="text-sm text-muted-foreground hidden sm:block">{formatDate(selectedDate)}</span>
        </div>
        <Button variant="outline" size="icon" onClick={() => changeDate(1)}><ChevronRight className="w-4 h-4" /></Button>
        <Button variant="outline" size="sm" onClick={() => goToDate(formatDateInput(new Date()))}>Today</Button>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-40 bg-muted rounded-lg animate-pulse" />)}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {mealTypes.map((meal) => (
            <Card key={meal} className="overflow-hidden">
              <CardHeader className={`py-3 px-4 border-b ${mealColors[meal]} bg-opacity-50`}>
                <CardTitle className="text-sm flex items-center gap-2 capitalize">
                  <span>{mealIcons[meal]}</span> {meal}
                  <Badge variant="secondary" className="ml-auto text-xs">{grouped[meal].length} items</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 space-y-2 min-h-[80px]">
                {grouped[meal].length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">No items added</p>
                ) : (
                  grouped[meal].map((item) => (
                    <div key={item.id} className="flex items-start gap-2 p-2 rounded-md hover:bg-muted/50 group">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium">{item.item_name}</p>
                        <div className="flex flex-wrap gap-2 mt-0.5">
                          {item.quantity && <span className="text-xs text-muted-foreground">{item.quantity}</span>}
                          {item.unit_cost && <span className="text-xs text-muted-foreground">PKR {item.unit_cost}</span>}
                          {item.notes && <span className="text-xs text-muted-foreground italic">{item.notes}</span>}
                        </div>
                      </div>
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => { setEditing(item); setForm({ date: item.date, meal_type: item.meal_type, item_name: item.item_name, quantity: item.quantity ?? "", unit_cost: item.unit_cost?.toString() ?? "", notes: item.notes ?? "" }); setDialogOpen(true); }}><Edit2 className="w-3 h-3" /></Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => handleDelete(item.id)}><Trash2 className="w-3 h-3" /></Button>
                      </div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {items.length === 0 && !loading && (
        <div className="flex flex-col items-center py-4 text-muted-foreground"><UtensilsCrossed className="w-8 h-8 mb-2 opacity-30" /><p className="text-sm">No food items for this date. Add your first meal!</p></div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Edit Food Item" : "Add Food Item"}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Meal Type</Label>
                <Select value={form.meal_type} onValueChange={(v) => setForm({ ...form, meal_type: v as MealType })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{mealTypes.map((m) => <SelectItem key={m} value={m} className="capitalize">{mealIcons[m]} {m}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5"><Label>Item Name *</Label><Input placeholder="e.g. Rice, Dal, Chicken..." value={form.item_name} onChange={(e) => setForm({ ...form, item_name: e.target.value })} /></div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5"><Label>Quantity</Label><Input placeholder="e.g. 2 kg" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Cost (PKR)</Label><Input type="number" placeholder="0" value={form.unit_cost} onChange={(e) => setForm({ ...form, unit_cost: e.target.value })} /></div>
            </div>
            <div className="space-y-1.5"><Label>Notes</Label><Textarea placeholder="Optional..." value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !form.item_name}>{saving ? "Saving..." : editing ? "Update" : "Add"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
