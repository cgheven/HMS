"use client"

import { useState, useTransition } from "react"
import { Receipt, Loader2, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "@/hooks/use-toast"
import { addExpenseAsManager } from "@/app/actions/managers"

interface PortalAddExpenseProps {
  hostelId: string
}

const CATEGORIES = [
  { value: "furniture",  label: "Furniture" },
  { value: "repairs",    label: "Repairs" },
  { value: "cleaning",   label: "Cleaning" },
  { value: "security",   label: "Security" },
  { value: "utilities",  label: "Utilities" },
  { value: "other",      label: "Other" },
]

function todayString() {
  return new Date().toISOString().slice(0, 10)
}

export function PortalAddExpense(_props: PortalAddExpenseProps) {
  const [category, setCategory]   = useState("other")
  const [amount, setAmount]       = useState("")
  const [description, setDescription] = useState("")
  const [date, setDate]           = useState(todayString)
  const [error, setError]         = useState<string | null>(null)
  const [success, setSuccess]     = useState(false)
  const [isPending, startTransition] = useTransition()

  const reset = () => {
    setCategory("other")
    setAmount("")
    setDescription("")
    setDate(todayString())
    setError(null)
    setSuccess(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const parsedAmount = Number(amount)
    if (!description.trim()) {
      setError("Description is required.")
      return
    }
    if (!parsedAmount || parsedAmount <= 0) {
      setError("Amount must be greater than 0.")
      return
    }

    startTransition(async () => {
      const result = await addExpenseAsManager(category, parsedAmount, description.trim(), date)

      if (result.error) {
        setError(result.error)
        return
      }

      setSuccess(true)
      toast({ title: "Expense recorded" })
      reset()
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Add Expense</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Record a hostel expense</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="category">Category</Label>
            <Select value={category} onValueChange={setCategory} disabled={isPending}>
              <SelectTrigger id="category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="amount">Amount (Rs.)</Label>
            <Input
              id="amount"
              type="number"
              min="1"
              step="1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="e.g. 2500"
              disabled={isPending}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="description">Description</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What was this expense for?"
              rows={3}
              disabled={isPending}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="date">Date</Label>
            <Input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={isPending}
              required
            />
          </div>

          {error && (
            <p className="text-sm text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          {success && (
            <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Expense recorded successfully.
            </div>
          )}

          <Button
            type="submit"
            disabled={isPending}
            className="w-full bg-amber text-black hover:bg-amber/90"
          >
            {isPending ? (
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
            ) : (
              <Receipt className="w-4 h-4 mr-2" />
            )}
            Record Expense
          </Button>
        </form>
      </div>
    </div>
  )
}
