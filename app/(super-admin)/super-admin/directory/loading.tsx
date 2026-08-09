export default function Loading() {
  return (
    <div className="animate-pulse p-6 space-y-4">
      <div className="h-9 w-48 bg-white/5 rounded-lg" />
      <div className="space-y-2">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="h-16 bg-white/5 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
