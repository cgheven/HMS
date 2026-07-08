"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Loader2, Home } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";

export default function LoginPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<"owner" | "manager">("owner");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const [managerPhone, setManagerPhone] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [showManagerPassword, setShowManagerPassword] = useState(false);
  const [managerLoading, setManagerLoading] = useState(false);

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast({ title: "Login failed", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    const { data: profile } = await supabase
      .from("hms_profiles")
      .select("role")
      .single();
    const home =
      profile?.role === "super_admin" ? "/super-admin"
      : profile?.role === "partner" ? "/partner"
      : "/dashboard";
    router.push(home);
    router.refresh();
  }

  async function handleManagerLogin(e: React.FormEvent) {
    e.preventDefault();
    setManagerLoading(true);
    const supabase = createClient();
    const normalizedPhone = managerPhone.replace(/\D/g, "");
    const syntheticEmail = `${normalizedPhone}@hms-portal.internal`;

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: syntheticEmail,
      password: managerPassword,
    });

    if (signInError) {
      toast({ title: "Login failed", description: "Invalid mobile number or password.", variant: "destructive" });
      setManagerLoading(false);
      return;
    }

    // Portal layout (server-side) verifies the session is a valid manager.
    // No client-side DB query needed — keeping hms_managers inaccessible from the browser.
    router.push("/portal");
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[600px] h-[400px] rounded-full bg-amber/5 blur-3xl" />
      </div>

      <div className="w-full max-w-sm relative animate-fade-up">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-amber/10 border border-amber/20 mb-5">
            <Home className="w-6 h-6 text-amber" />
          </div>
          <h1 className="font-serif text-3xl text-foreground tracking-tight">HMS</h1>
          <p className="text-muted-foreground text-sm mt-1">Hostel Management System</p>
        </div>

        <div className="rounded-2xl border border-sidebar-border bg-card p-8 shadow-2xl">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-foreground">Welcome back</h2>
            <p className="text-sm text-muted-foreground mt-1">Sign in to your account</p>
          </div>

          <div className="flex gap-1 p-1 bg-background/50 rounded-lg mb-6 border border-sidebar-border">
            <button
              type="button"
              onClick={() => setActiveTab("owner")}
              className={`flex-1 text-sm font-medium py-1.5 rounded-md transition-all duration-200 ${
                activeTab === "owner"
                  ? "bg-amber text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Owner
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("manager")}
              className={`flex-1 text-sm font-medium py-1.5 rounded-md transition-all duration-200 ${
                activeTab === "manager"
                  ? "bg-amber text-background shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Manager
            </button>
          </div>

          {activeTab === "owner" ? (
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoComplete="email"
                  disabled={loading}
                  className="h-10 bg-background/50 border-sidebar-border focus-visible:ring-amber/40 focus-visible:border-amber/50"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    disabled={loading}
                    className="h-10 pr-10 bg-background/50 border-sidebar-border focus-visible:ring-amber/40 focus-visible:border-amber/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={loading}
                className="w-full h-10 mt-2 bg-amber text-background font-semibold hover:bg-amber/90 transition-all duration-200 glow-amber"
              >
                {loading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Signing in…</>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleManagerLogin} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="manager-phone" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Mobile Number
                </Label>
                <Input
                  id="manager-phone"
                  type="tel"
                  placeholder="03XXXXXXXXX"
                  value={managerPhone}
                  onChange={(e) => setManagerPhone(e.target.value)}
                  required
                  autoComplete="tel"
                  disabled={managerLoading}
                  className="h-10 bg-background/50 border-sidebar-border focus-visible:ring-amber/40 focus-visible:border-amber/50"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="manager-password" className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="manager-password"
                    type={showManagerPassword ? "text" : "password"}
                    placeholder="••••••••"
                    value={managerPassword}
                    onChange={(e) => setManagerPassword(e.target.value)}
                    required
                    autoComplete="current-password"
                    disabled={managerLoading}
                    className="h-10 pr-10 bg-background/50 border-sidebar-border focus-visible:ring-amber/40 focus-visible:border-amber/50"
                  />
                  <button
                    type="button"
                    onClick={() => setShowManagerPassword(!showManagerPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    tabIndex={-1}
                  >
                    {showManagerPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={managerLoading}
                className="w-full h-10 mt-2 bg-amber text-background font-semibold hover:bg-amber/90 transition-all duration-200 glow-amber"
              >
                {managerLoading ? (
                  <><Loader2 className="w-4 h-4 animate-spin" />Signing in…</>
                ) : (
                  "Sign in"
                )}
              </Button>
            </form>
          )}

          <p className="text-center text-xs text-muted-foreground/60 mt-6 leading-relaxed">
            Access restricted to authorized users only.
            <br />
            Contact your administrator for access.
          </p>
        </div>
      </div>
    </div>
  );
}
