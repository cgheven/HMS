export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-9 w-56 bg-white/5 rounded-lg" />
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-20 bg-white/5 rounded-xl" />
        ))}
      </div>
      <div className="h-64 bg-white/5 rounded-xl" />
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-14 bg-white/5 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
