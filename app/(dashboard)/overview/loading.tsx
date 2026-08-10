export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-9 w-52 bg-white/5 rounded-lg" />
        <div className="h-4 w-40 bg-white/5 rounded" />
      </div>

      <div className="rounded-2xl border border-sidebar-border bg-card p-4 space-y-3">
        <div className="h-8 w-72 bg-white/5 rounded-lg" />
        <div className="h-7 w-full max-w-md bg-white/5 rounded-lg" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className={`h-32 bg-white/5 rounded-2xl ${i === 0 ? "col-span-2 lg:col-span-1" : ""}`} />
        ))}
      </div>

      <div className="h-24 bg-white/5 rounded-2xl" />

      <div className="rounded-2xl border border-sidebar-border bg-card p-4 space-y-2">
        <div className="h-8 bg-white/5 rounded-lg" />
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-12 bg-white/5 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
