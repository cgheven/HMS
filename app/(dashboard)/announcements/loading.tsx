export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-9 w-48 bg-white/5 rounded-lg" />
        <div className="h-9 w-40 bg-white/5 rounded-lg" />
      </div>
      <div className="space-y-3">
        {[...Array(4)].map((_, i) => <div key={i} className="h-28 bg-white/5 rounded-2xl" />)}
      </div>
    </div>
  );
}
