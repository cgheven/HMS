# HMS — Claude Code Instructions  

## Stack
- Next.js 15 App Router · React 19 · TypeScript · Supabase (PostgreSQL + Auth + Storage)
- Tailwind CSS · shadcn/ui components
- Server Actions for all writes · Server Components for data fetching

---

## Performance rules — apply to every new feature  

### 1. Parallel DB queries with Promise.all
Never chain awaits for independent queries. Always fan out.

```typescript
// ✗ slow — sequential
const tenants = await supabase.from("hms_tenants").select("*")...;
const rooms   = await supabase.from("hms_rooms").select("*")...;

// ✓ fast — parallel
const [{ data: tenants }, { data: rooms }] = await Promise.all([
  supabase.from("hms_tenants").select("*")...,
  supabase.from("hms_rooms").select("*")...,
]);
```

### 2. Use FK joins instead of two queries + JS map
```typescript
// ✗ slow — two round trips + JS roomMap loop
const { data: tenants } = await supabase.from("hms_tenants").select("*")...;
const { data: rooms }   = await supabase.from("hms_rooms").select("*")...;
const roomMap = Object.fromEntries(rooms.map(r => [r.id, r]));

// ✓ fast — one query with FK join
const { data: tenants } = await supabase
  .from("hms_tenants")
  .select("*, room:hms_rooms(room_number)")...;
```

### 3. Never auto-sync in useEffect on mount
useEffect that calls a server action / fetch on every mount adds latency and wastes server resources.

```typescript
// ✗ syncs on every page load
useEffect(() => { syncMonth(initialMonth); }, []);

// ✓ only sync on user action (button click, form submit)
<button onClick={() => syncMonth(month)}>Sync</button>
```

### 4. Add loading.tsx for every new route segment
Each `app/(dashboard)/your-feature/` directory needs a `loading.tsx`. Without it, there's no streaming skeleton and the page blocks until all data is ready.

```typescript
// app/(dashboard)/your-feature/loading.tsx
export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-9 w-48 bg-white/5 rounded-lg" />
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-14 bg-white/5 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
```

### 5. Deduplicate shared queries with React cache()
Functions called from both layout and page (e.g. getAuthContext) must be wrapped with React's cache() to avoid duplicate DB hits in the same render pass.

```typescript
import { cache } from "react";
export const getAuthContext = cache(async () => { ... });
```

### 6. Heavy client components must use dynamic() with ssr: false
Charts, rich editors, or anything that imports large libraries must be lazily loaded.

```typescript
// components/modules/dashboard/expense-chart-client.tsx
"use client";
import dynamic from "next/dynamic";
export const ExpenseChartClient = dynamic(
  () => import("./expense-chart").then((m) => m.ExpenseChart),
  { ssr: false, loading: () => <div className="h-[220px] animate-pulse rounded-xl bg-white/5" /> }
);
```

### 7. Deduplicate repeated data in reports / multi-query actions
Before adding a query to a Promise.all block, check whether the data can be derived from an existing query result in JS instead.

### 8. key={hostelId} on every page client component
Every server page that passes initial data to a client component MUST include `key={hostelId ?? ''}`. This forces React to remount the component (resetting all useState) when the user switches branches.

```typescript
// app/(dashboard)/spaces/page.tsx
const { hostelId, rooms } = await getRooms();
return <SpacesClient key={hostelId ?? ''} hostelId={hostelId} initialRooms={rooms} />;
```

Without this, branch switching updates the header but leaves page content frozen at the previous branch's data, because useState() ignores prop changes after initial mount.

---

## Branch switching architecture

- Active branch stored as httpOnly cookie `hms_active_hostel` (set server-side only)
- `switchActiveHostel()` server action: session check + `cookies().set()` — no ownership DB queries (getAuthContext validates on every request anyway)
- Client: `startTransition(async () => { const result = await switchActiveHostel(id); window.location.reload(); })`
- **Must use `window.location.reload()`**, NOT `router.refresh()`. The Next.js 15 client-side router cache races with the Set-Cookie header from the Server Action — the RSC request fires before the browser commits the new cookie. `window.location.reload()` is a browser-level navigation that always sends the fully-committed cookie jar (same as opening a new tab, which always works).

---

## Data fetching pattern

All data fetching goes through `lib/data.ts` functions that call `getAuthContext()`.
`getAuthContext` is cached with React `cache()` — layout + page share one DB hit per render.

```
DashboardLayout (server)
  └─ getAuthContext() ──► reads hms_active_hostel cookie → hostelId
  └─ HostelProvider (client context)
       └─ DashboardShell → Navbar → HostelSwitcher

SpacesPage (server)
  └─ getRooms() → getAuthContext() [cache hit, 0 extra DB queries] → hostelId
  └─ SpacesClient key={hostelId}  ← required for branch switching
```

---

## Security — non-negotiable

- `.env.local` must never be committed
- `SUPABASE_SERVICE_ROLE_KEY` never in client components or browser bundles
- All writes use `createAdminClient()` (service role) inside server actions
- All server actions call `requireOwnerOrAbove()` + `resolveHostelId()` before touching data
- CNIC must never appear in public-facing receipts
- `supabase/.temp/` must remain in `.gitignore`

---

## Code style

- No comments unless the WHY is non-obvious
- No auto-generated docstrings
- `npx tsc --noEmit` must pass after every change — run it and confirm before reporting done
- Prefer editing existing files over creating new ones
- No backwards-compatibility shims for removed code — delete it cleanly
