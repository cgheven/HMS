export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-9 w-44 bg-white/5 rounded-lg" />
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => <div key={i} className="h-20 bg-white/5 rounded-2xl" />)}
      </div>
      <div className="h-10 bg-white/5 rounded-xl" />
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => <div key={i} className="h-20 bg-white/5 rounded-xl" />)}
      </div>
    </div>
  );
}
