import { requireSuperAdmin } from "@/lib/auth";
import { listCampaignTemplates, listCampaignAudience } from "@/app/actions/lead-campaigns";
import { MarketingClient } from "@/components/modules/super-admin/marketing-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminMarketingPage() {
  await requireSuperAdmin();

  // Templates first — the audience query is keyed on a template name, so there
  // is nothing to fetch until we know which templates exist.
  const { templates, error } = await listCampaignTemplates();
  const list = templates ?? [];
  const first = list.find((t) => !t.unsupported) ?? list[0] ?? null;

  const { rows } = first ? await listCampaignAudience(first.name) : { rows: [] };

  return (
    <MarketingClient
      initialTemplate={first?.name ?? null}
      templates={list}
      initialRows={rows ?? []}
      loadError={error ?? null}
    />
  );
}
