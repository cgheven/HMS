"use client";

import { useEffect, useState, useTransition } from "react";
import {
  Users, Plus, Mail, Shield, ShieldOff, Trash2,
  Edit2, KeyRound, Search, Building2, Clock,
  CheckCircle2, RefreshCw, Send, Eye, EyeOff,
} from "lucide-react";
import {
  listAdminUsers,
  createUserWithPassword,
  inviteUser,
  updateAdminUser,
  deleteAdminUser,
  resetUserPassword,
} from "@/app/actions/admin-users";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import type { AdminUser } from "@/types";

type DialogMode = "create" | "invite" | "edit" | "reset" | "delete" | null;

const emptyCreate = { email: "", full_name: "", password: "", confirmPassword: "" };
const emptyEdit = { email: "", full_name: "", is_admin: false };
const emptyReset = { password: "", confirmPassword: "" };

export default function AdminUsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [filtered, setFiltered] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogMode, setDialogMode] = useState<DialogMode>(null);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [createForm, setCreateForm] = useState(emptyCreate);
  const [inviteEmail, setInviteEmail] = useState({ email: "", full_name: "" });
  const [editForm, setEditForm] = useState(emptyEdit);
  const [resetForm, setResetForm] = useState(emptyReset);
  const [showPw, setShowPw] = useState(false);
  const [showPwConfirm, setShowPwConfirm] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => { loadUsers(); }, []);

  useEffect(() => {
    const q = search.toLowerCase();
    setFiltered(
      users.filter(
        (u) =>
          u.email.toLowerCase().includes(q) ||
          (u.full_name ?? "").toLowerCase().includes(q) ||
          (u.hostel?.name ?? "").toLowerCase().includes(q)
      )
    );
  }, [search, users]);

  async function loadUsers() {
    setLoading(true);
    const result = await listAdminUsers();
    if (result.error) {
      toast({ title: "Error loading users", description: result.error, variant: "destructive" });
    } else {
      setUsers(result.users ?? []);
    }
    setLoading(false);
  }

  function openCreate() { setCreateForm(emptyCreate); setShowPw(false); setDialogMode("create"); }
  function openInvite() { setInviteEmail({ email: "", full_name: "" }); setDialogMode("invite"); }
  function openEdit(u: AdminUser) {
    setSelectedUser(u);
    setEditForm({ email: u.email, full_name: u.full_name ?? "", is_admin: u.is_admin });
    setDialogMode("edit");
  }
  function openReset(u: AdminUser) {
    setSelectedUser(u);
    setResetForm(emptyReset);
    setShowPw(false);
    setDialogMode("reset");
  }
  function openDelete(u: AdminUser) { setSelectedUser(u); setDialogMode("delete"); }

  function handleCreate() {
    if (createForm.password !== createForm.confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    startTransition(async () => {
      const res = await createUserWithPassword({
        email: createForm.email,
        password: createForm.password,
        full_name: createForm.full_name,
      });
      if (res.error) {
        toast({ title: "Failed to create user", description: res.error, variant: "destructive" });
      } else {
        toast({ title: "User created successfully" });
        setDialogMode(null);
        loadUsers();
      }
    });
  }

  function handleInvite() {
    startTransition(async () => {
      const res = await inviteUser(inviteEmail);
      if (res.error) {
        toast({ title: "Failed to send invite", description: res.error, variant: "destructive" });
      } else {
        toast({ title: "Invite sent", description: `Email sent to ${inviteEmail.email}` });
        setDialogMode(null);
      }
    });
  }

  function handleEdit() {
    if (!selectedUser) return;
    startTransition(async () => {
      const res = await updateAdminUser({
        userId: selectedUser.id,
        email: editForm.email !== selectedUser.email ? editForm.email : undefined,
        full_name: editForm.full_name,
        is_admin: editForm.is_admin,
      });
      if (res.error) {
        toast({ title: "Failed to update user", description: res.error, variant: "destructive" });
      } else {
        toast({ title: "User updated" });
        setDialogMode(null);
        loadUsers();
      }
    });
  }

  function handleReset() {
    if (!selectedUser) return;
    if (resetForm.password !== resetForm.confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    startTransition(async () => {
      const res = await resetUserPassword({ userId: selectedUser.id, newPassword: resetForm.password });
      if (res.error) {
        toast({ title: "Failed to reset password", description: res.error, variant: "destructive" });
      } else {
        toast({ title: "Password reset successfully" });
        setDialogMode(null);
      }
    });
  }

  function handleDelete() {
    if (!selectedUser) return;
    startTransition(async () => {
      const res = await deleteAdminUser(selectedUser.id);
      if (res.error) {
        toast({ title: "Failed to delete user", description: res.error, variant: "destructive" });
      } else {
        toast({ title: "User deleted" });
        setDialogMode(null);
        loadUsers();
      }
    });
  }

  const stats = {
    total: users.length,
    admins: users.filter((u) => u.is_admin).length,
    active: users.filter((u) => u.last_sign_in_at).length,
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Admin Header */}
      <div className="border-b bg-sidebar text-white">
        <div className="container mx-auto px-4 sm:px-6 py-4 max-w-7xl">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-white/10">
                <Shield className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-white">Admin Panel</h1>
                <p className="text-white/60 text-xs">User Management</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="text-white/80 hover:text-white hover:bg-white/10 gap-2"
                onClick={loadUsers}
                disabled={loading}
              >
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                <span className="hidden sm:inline">Refresh</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="border border-white/30 text-white/80 hover:text-white hover:bg-white/10 gap-2"
                onClick={openInvite}
              >
                <Send className="w-4 h-4" />
                <span className="hidden sm:inline">Invite</span>
              </Button>
              <Button
                size="sm"
                className="bg-white text-sidebar hover:bg-white/90 gap-2"
                onClick={openCreate}
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">Create User</span>
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: "Total Users", value: stats.total, icon: Users, color: "text-blue-600", bg: "bg-blue-50" },
            { label: "Admins", value: stats.admins, icon: Shield, color: "text-purple-600", bg: "bg-purple-50" },
            { label: "Active (logged in)", value: stats.active, icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50" },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <Card key={label}>
              <CardContent className="p-4 flex items-center gap-3">
                <div className={`p-2 rounded-lg ${bg} shrink-0`}>
                  <Icon className={`w-4 h-4 ${color}`} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground truncate">{label}</p>
                  <p className="text-2xl font-bold">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Search */}
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search by name, email, hostel..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Users Table */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">
              Hostel Owners ({filtered.length})
            </CardTitle>
            <CardDescription>
              All registered users. Each user manages their own isolated hostel.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
                <Users className="w-10 h-10 mb-3 opacity-30" />
                <p className="font-medium">No users found</p>
                <p className="text-sm mt-1">Create or invite a hostel owner to get started</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/30">
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3">User</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden sm:table-cell">Hostel</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden md:table-cell">Last Login</th>
                      <th className="text-left text-xs font-medium text-muted-foreground px-4 py-3 hidden lg:table-cell">Joined</th>
                      <th className="text-right text-xs font-medium text-muted-foreground px-4 py-3">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {filtered.map((user) => (
                      <tr key={user.id} className="hover:bg-muted/20 transition-colors group">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-sidebar text-white flex items-center justify-center text-xs font-bold shrink-0">
                              {(user.full_name ?? user.email).charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="font-medium text-sm truncate">
                                  {user.full_name ?? "—"}
                                </p>
                                {user.is_admin && (
                                  <Badge variant="secondary" className="text-xs gap-1 py-0">
                                    <Shield className="w-2.5 h-2.5" /> Admin
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 hidden sm:table-cell">
                          {user.hostel ? (
                            <div className="flex items-center gap-1.5">
                              <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm truncate">{user.hostel.name}</p>
                                <p className="text-xs text-muted-foreground">{user.hostel.total_capacity} cap.</p>
                              </div>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">No hostel</span>
                          )}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          {user.last_sign_in_at ? (
                            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                              <Clock className="w-3.5 h-3.5 shrink-0" />
                              {formatDate(user.last_sign_in_at)}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">Never</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground hidden lg:table-cell">
                          {formatDate(user.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Edit user"
                              onClick={() => openEdit(user)}
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Reset password"
                              onClick={() => openReset(user)}
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive"
                              title="Delete user"
                              onClick={() => openDelete(user)}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Create User Dialog ─────────────────────────────────────────────── */}
      <Dialog open={dialogMode === "create"} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="w-4 h-4" /> Create User
            </DialogTitle>
            <DialogDescription>
              Create a new hostel owner account with email and password.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input
                placeholder="John Doe"
                value={createForm.full_name}
                onChange={(e) => setCreateForm({ ...createForm, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input
                type="email"
                placeholder="owner@example.com"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Password * (min 8 chars)</Label>
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  placeholder="••••••••"
                  value={createForm.password}
                  onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Confirm Password *</Label>
              <div className="relative">
                <Input
                  type={showPwConfirm ? "text" : "password"}
                  placeholder="••••••••"
                  value={createForm.confirmPassword}
                  onChange={(e) => setCreateForm({ ...createForm, confirmPassword: e.target.value })}
                  className="pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPwConfirm(!showPwConfirm)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  tabIndex={-1}
                >
                  {showPwConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {createForm.confirmPassword && createForm.password !== createForm.confirmPassword && (
                <p className="text-xs text-destructive">Passwords don't match</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogMode(null)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={
                isPending ||
                !createForm.email ||
                !createForm.password ||
                createForm.password !== createForm.confirmPassword ||
                createForm.password.length < 8
              }
            >
              {isPending ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Invite Dialog ──────────────────────────────────────────────────── */}
      <Dialog open={dialogMode === "invite"} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Send className="w-4 h-4" /> Invite User
            </DialogTitle>
            <DialogDescription>
              Send a magic link invite. User sets their own password on first login.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input
                placeholder="John Doe"
                value={inviteEmail.full_name}
                onChange={(e) => setInviteEmail({ ...inviteEmail, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email *</Label>
              <Input
                type="email"
                placeholder="owner@example.com"
                value={inviteEmail.email}
                onChange={(e) => setInviteEmail({ ...inviteEmail, email: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogMode(null)}>Cancel</Button>
            <Button onClick={handleInvite} disabled={isPending || !inviteEmail.email}>
              {isPending ? "Sending..." : "Send Invite"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Edit User Dialog ───────────────────────────────────────────────── */}
      <Dialog open={dialogMode === "edit"} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Edit2 className="w-4 h-4" /> Edit User
            </DialogTitle>
            <DialogDescription>{selectedUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>Full Name</Label>
              <Input
                placeholder="John Doe"
                value={editForm.full_name}
                onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                type="email"
                value={editForm.email}
                onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
              />
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Admin Access</p>
                <p className="text-xs text-muted-foreground">Can manage all users</p>
              </div>
              <button
                onClick={() => setEditForm({ ...editForm, is_admin: !editForm.is_admin })}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors border ${
                  editForm.is_admin
                    ? "bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100"
                    : "bg-muted text-muted-foreground border-border hover:bg-accent"
                }`}
              >
                {editForm.is_admin ? (
                  <><Shield className="w-3.5 h-3.5" /> Admin</>
                ) : (
                  <><ShieldOff className="w-3.5 h-3.5" /> User</>
                )}
              </button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogMode(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={isPending}>
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reset Password Dialog ──────────────────────────────────────────── */}
      <Dialog open={dialogMode === "reset"} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4" /> Reset Password
            </DialogTitle>
            <DialogDescription>{selectedUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <Label>New Password * (min 8 chars)</Label>
              <div className="relative">
                <Input
                  type={showPw ? "text" : "password"}
                  placeholder="••••••••"
                  value={resetForm.password}
                  onChange={(e) => setResetForm({ ...resetForm, password: e.target.value })}
                  className="pr-10"
                />
                <button type="button" onClick={() => setShowPw(!showPw)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" tabIndex={-1}>
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Confirm New Password *</Label>
              <Input
                type="password"
                placeholder="••••••••"
                value={resetForm.confirmPassword}
                onChange={(e) => setResetForm({ ...resetForm, confirmPassword: e.target.value })}
              />
              {resetForm.confirmPassword && resetForm.password !== resetForm.confirmPassword && (
                <p className="text-xs text-destructive">Passwords don't match</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogMode(null)}>Cancel</Button>
            <Button
              onClick={handleReset}
              disabled={
                isPending ||
                !resetForm.password ||
                resetForm.password !== resetForm.confirmPassword ||
                resetForm.password.length < 8
              }
            >
              {isPending ? "Resetting..." : "Reset Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirm Dialog ──────────────────────────────────────────── */}
      <Dialog open={dialogMode === "delete"} onOpenChange={(o) => !o && setDialogMode(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="w-4 h-4" /> Delete User
            </DialogTitle>
            <DialogDescription>
              This will permanently delete <strong>{selectedUser?.email}</strong> and all their hostel data. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogMode(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {isPending ? "Deleting..." : "Yes, Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
