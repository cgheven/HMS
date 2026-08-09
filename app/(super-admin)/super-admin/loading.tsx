// Without this the Dashboard renders NOTHING until every query resolves, so the
// browser sits on the previous page for the whole server render — the "sleep
// mode" the owner described. A skeleton makes navigation feel instant without
// making the data any faster.
export default function Loading() {
  return (
    <div className="animate-pulse p-6 space-y-6">
      <div className="h-9 w-56 bg-white/5 rounded-lg" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-28 bg-white/5 rounded-2xl" />
        ))}
      </div>
      <div className="h-64 bg-white/5 rounded-2xl" />
    </div>
  );
}
