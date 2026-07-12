export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-9 w-48 bg-white/5 rounded-lg" />
      <div className="grid grid-cols-2 gap-3">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 bg-white/5 rounded-xl" />
        ))}
      </div>
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-24 bg-white/5 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
