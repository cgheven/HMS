export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-40 bg-white/5 rounded-lg" />
      <div className="rounded-xl border border-white/10 bg-white/[0.02] p-6 space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-10 bg-white/5 rounded-lg" />
        ))}
        <div className="h-10 w-32 bg-white/5 rounded-lg" />
      </div>
    </div>
  )
}
