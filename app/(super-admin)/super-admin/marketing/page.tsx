import { requireSuperAdmin } from "@/lib/auth";
import {
  listCampaignTemplates, listCampaignAudience, listCampaignHistory,
} from "@/app/actions/lead-campaigns";
import { listLeadLists } from "@/app/actions/lead-lists";
import { defaultCampaignTemplate } from "@/lib/lead-campaigns";
import { MarketingClient } from "@/components/modules/super-admin/marketing-client";

export const dynamic = "force-dynamic";

export default async function SuperAdminMarketingPage() {
  await requireSuperAdmin();

  // Templates first — the audience query is keyed on a template name, so there
  // is nothing to fetch until we know which templates exist.
  const { templates, error } = await listCampaignTemplates();
  const list = templates ?? [];
  const first = defaultCampaignTemplate(list);

  // Independent of each other, so they fan out rather than chain.
  const [{ rows }, { rows: history }, { lists }] = await Promise.all([
    first ? listCampaignAudience(first.name) : Promise.resolve({ rows: [] }),
    listCampaignHistory(),
    listLeadLists(),
  ]);

  return (
    <MarketingClient
      initialTemplate={first?.name ?? null}
      templates={list}
      initialRows={rows ?? []}
      history={history ?? []}
      initialLists={lists}
      loadError={error ?? null}
    />
  );
}
