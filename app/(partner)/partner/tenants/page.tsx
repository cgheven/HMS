import { getPartnerTenants } from "@/app/actions/partner";
import { Users, Phone, BedDouble } from "lucide-react";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

const PACKAGE_LABELS: Record<string, string> = {
  space_only:    "Space Only",
  space_food:    "Space + Food",
  space_food_ac: "Space + Food + AC",
};

export default async function PartnerTenantsPage() {
  const { tenants, error } = await getPartnerTenants();

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-3 text-muted-foreground p-6">
        <Users className="w-10 h-10 opacity-20" />
        <p className="text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-serif font-normal tracking-tight text-foreground">
            Tenants
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Active residents — read-only view
          </p>
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber/[0.06] border border-amber/15 text-xs text-amber">
          {tenants?.length ?? 0} active
        </div>
      </div>

      {/* List */}
      <div className="rounded-2xl border border-sidebar-border bg-card overflow-hidden">
        {!tenants || tenants.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground">
            <Users className="w-10 h-10 opacity-20" />
            <p className="text-sm">No active tenants</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {tenants.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-4 px-4 py-3 rounded-xl hover:bg-white/[0.03] transition-colors border border-transparent hover:border-white/5"
              >
                {/* Avatar */}
                <div className="flex items-center justify-center w-9 h-9 rounded-full bg-amber/10 border border-amber/20 text-amber text-sm font-semibold shrink-0">
                  {t.full_name[0]?.toUpperCase() ?? "?"}
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-foreground">{t.full_name}</p>
                    <Badge variant="secondary" className="text-xs capitalize">{t.type}</Badge>
                    {t.package_tier !== "space_only" && (
                      <Badge variant="secondary" className="text-xs text-blue-400 border-blue-500/20 bg-blue-500/10">
                        {PACKAGE_LABELS[t.package_tier] ?? t.package_tier}
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5">
                    {t.room_number && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <BedDouble className="w-2.5 h-2.5" />
                        Room {t.room_number}
                        {t.bed_number ? ` · Bed ${t.bed_number}` : ""}
                      </span>
                    )}
                    {t.phone && (
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Phone className="w-2.5 h-2.5" />
                        {t.phone}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground">
                      In: {formatDate(t.check_in)}
                    </span>
                  </div>
                </div>

                {/* Rent */}
                <div className="text-right shrink-0 hidden sm:block">
                  {t.billing_type === "daily" ? (
                    <p className="text-sm font-semibold text-foreground">
                      {formatCurrency(t.monthly_rent)}
                      <span className="text-xs text-muted-foreground font-normal">/day</span>
                    </p>
                  ) : (
                    <p className="text-sm font-semibold text-foreground">
                      {formatCurrency(t.monthly_rent)}
                      <span className="text-xs text-muted-foreground font-normal">/mo</span>
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
