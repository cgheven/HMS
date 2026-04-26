export default function FoodLoading() {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div className="h-8 w-40 bg-muted rounded animate-pulse" />
        <div className="h-9 w-28 bg-muted rounded animate-pulse" />
      </div>
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 bg-muted rounded animate-pulse" />
        <div className="h-9 w-36 bg-muted rounded animate-pulse" />
        <div className="h-9 w-9 bg-muted rounded animate-pulse" />
        <div className="h-9 w-20 bg-muted rounded animate-pulse" />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-40 bg-muted rounded-lg animate-pulse" />
        ))}
      </div>
    </div>
  );
}
