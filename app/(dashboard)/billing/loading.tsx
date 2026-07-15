export default function BillingLoading() {
  return (
    <div className="space-y-6">
      <div className="h-8 w-32 bg-muted rounded animate-pulse" />
      <div className="h-28 bg-muted rounded-xl animate-pulse" />
      <div className="space-y-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-14 bg-muted rounded-xl animate-pulse" />
        ))}
      </div>
    </div>
  );
}
