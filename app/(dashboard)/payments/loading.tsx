export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-9 w-36 bg-white/5 rounded-lg" />
        <div className="h-9 w-40 bg-white/5 rounded-lg" />
      </div>
      <div className="grid grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-24 bg-white/5 rounded-2xl" />)}
      </div>
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => <div key={i} className="h-14 bg-white/5 rounded-xl" />)}
      </div>
    </div>
  );
}
