export default function Loading() {
  return (
    <div className="animate-pulse p-6 space-y-4">
      <div className="h-9 w-52 bg-white/5 rounded-lg" />
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-20 bg-white/5 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
