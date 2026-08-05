export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-sidebar-border px-4 sm:px-6 h-14 flex items-center">
        <div className="flex items-center gap-3 max-w-7xl mx-auto w-full animate-pulse">
          <div className="w-8 h-8 rounded-lg bg-white/5 shrink-0" />
          <div className="space-y-1.5">
            <div className="h-4 w-24 bg-white/5 rounded" />
            <div className="h-3 w-52 bg-white/5 rounded" />
          </div>
        </div>
      </div>
      <div className="container mx-auto px-4 sm:px-6 py-6 max-w-7xl space-y-5 animate-pulse">
        <div className="flex flex-col lg:flex-row gap-3">
          <div className="h-10 w-full lg:max-w-sm bg-white/5 rounded-md" />
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:flex gap-2 flex-1">
            {[44, 36, 48, 44, 40].map((w, i) => (
              <div key={i} className="h-9 bg-white/5 rounded-md" style={{ width: `${w * 4}px` }} />
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-sidebar-border overflow-hidden">
          <div className="h-12 bg-white/[0.03] border-b border-sidebar-border" />
          <div className="divide-y divide-sidebar-border">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-16 bg-white/[0.02]" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
