export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-9 w-36 bg-white/5 rounded-lg" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {[...Array(4)].map((_, i) => <div key={i} className="h-64 bg-white/5 rounded-2xl" />)}
      </div>
    </div>
  );
}
