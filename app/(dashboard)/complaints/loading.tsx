export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-9 w-36 bg-white/5 rounded-lg" />
        <div className="h-9 w-36 bg-white/5 rounded-lg" />
      </div>
      <div className="grid grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-white/5 rounded-2xl" />)}
      </div>
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-white/5 rounded-xl" />)}
      </div>
    </div>
  );
}
