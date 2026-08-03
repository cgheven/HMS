export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-9 w-40 bg-white/5 rounded-lg" />
          <div className="h-4 w-72 bg-white/5 rounded-lg" />
        </div>
        <div className="h-10 w-44 bg-white/5 rounded-lg" />
      </div>

      <div className="rounded-2xl border border-sidebar-border bg-card p-4 sm:p-6 space-y-3">
        <div className="h-12 bg-white/5 rounded-lg" />
        <div className="h-3 w-80 bg-white/5 rounded-lg" />
        <div className="flex gap-1.5 pt-1">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-7 w-20 bg-white/5 rounded-full" />
          ))}
        </div>
      </div>

      <div className="h-4 w-48 bg-white/5 rounded-lg" />

      <div className="rounded-2xl border border-sidebar-border bg-card p-4 sm:p-6 space-y-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-14 bg-white/5 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
