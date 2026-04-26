export default function BillsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="h-8 w-20 bg-muted rounded animate-pulse" />
        <div className="h-9 w-28 bg-muted rounded animate-pulse" />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-20 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
      <div className="flex gap-3">
        <div className="h-9 flex-1 max-w-sm bg-muted rounded animate-pulse" />
        <div className="h-9 w-40 bg-muted rounded animate-pulse" />
      </div>
      <div className="h-80 bg-muted rounded-lg animate-pulse" />
    </div>
  );
}
