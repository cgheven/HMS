"use client"

import { useState, useTransition } from "react"
import { UserPlus, Loader2, CheckCircle2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { toast } from "@/hooks/use-toast"
import { addTenantAsManager } from "@/app/actions/managers"

interface Room {
  id: string
  room_number: string
  capacity: number
  occupied: number
}

interface PortalAddMemberProps {
  hostelId: string
  rooms: Room[]
}

function todayString() {
  return new Date().toISOString().slice(0, 10)
}

// Radix Select forbids an empty-string Item value (reserved to mean "cleared,
// show placeholder"), so "no room" needs its own sentinel that's translated
// back to "" when read/written from roomId state.
const NO_ROOM = "__none__"

export function PortalAddMember({ rooms }: PortalAddMemberProps) {
  const availableRooms = rooms.filter((r) => r.occupied < r.capacity)

  const [name, setName]           = useState("")
  const [phone, setPhone]         = useState("")
  const [roomId, setRoomId]       = useState("")
  const [rent, setRent]           = useState("")
  const [checkIn, setCheckIn]     = useState(todayString)
  const [error, setError]         = useState<string | null>(null)
  const [success, setSuccess]     = useState(false)
  const [isPending, startTransition] = useTransition()

  const reset = () => {
    setName("")
    setPhone("")
    setRoomId("")
    setRent("")
    setCheckIn(todayString())
    setError(null)
    setSuccess(false)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(false)

    const monthlyRent = Number(rent)
    if (!name.trim() || name.trim().length < 2) {
      setError("Full name must be at least 2 characters.")
      return
    }
    if (!phone.trim()) {
      setError("Phone number is required.")
      return
    }
    if (!monthlyRent || monthlyRent <= 0) {
      setError("Monthly rent must be greater than 0.")
      return
    }

    startTransition(async () => {
      const result = await addTenantAsManager({
        name: name.trim(),
        phone: phone.trim(),
        roomId: roomId || null,
        monthlyRent,
        checkIn,
      })

      if (result.error) {
        setError(result.error)
        return
      }

      setSuccess(true)
      toast({ title: "Member added successfully" })
      reset()
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Add Member</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Register a new tenant for this hostel</p>
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1.5">
            <Label htmlFor="full-name">Full Name</Label>
            <Input
              id="full-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Ahmed Hassan"
              disabled={isPending}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="phone">Mobile Number</Label>
            <Input
              id="phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="03XXXXXXXXX"
              disabled={isPending}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="room">Room</Label>
            <Select
              value={roomId || NO_ROOM}
              onValueChange={(v) => setRoomId(v === NO_ROOM ? "" : v)}
              disabled={isPending}
            >
              <SelectTrigger id="room">
                <SelectValue placeholder="Select a room (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_ROOM}>No room assigned</SelectItem>
                {availableRooms.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    Room {r.room_number} — {r.capacity - r.occupied} bed{r.capacity - r.occupied !== 1 ? "s" : ""} available
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {availableRooms.length === 0 && (
              <p className="text-xs text-amber/70">No available rooms — you can still add a member without a room.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="rent">Monthly Rent (Rs.)</Label>
            <Input
              id="rent"
              type="number"
              min="1"
              step="1"
              value={rent}
              onChange={(e) => setRent(e.target.value)}
              placeholder="e.g. 8000"
              disabled={isPending}
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="check-in">Move In Date</Label>
            <Input
              id="check-in"
              type="date"
              value={checkIn}
              onChange={(e) => setCheckIn(e.target.value)}
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
              Member added successfully.
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
              <UserPlus className="w-4 h-4 mr-2" />
            )}
            Add Member
          </Button>
        </form>
      </div>
    </div>
  )
}
