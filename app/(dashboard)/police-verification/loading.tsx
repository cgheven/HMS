export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-9 w-64 bg-white/5 rounded-lg" />
      <div className="h-40 bg-white/5 rounded-xl" />
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => <div key={i} className="h-14 bg-white/5 rounded-xl" />)}
      </div>
    </div>
  );
}
