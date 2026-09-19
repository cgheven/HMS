export default function BranchDeleteLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-sidebar-border bg-card p-6 space-y-4 animate-pulse">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-full bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-48 bg-muted rounded" />
            <div className="h-3 w-64 bg-muted rounded" />
          </div>
        </div>
        <div className="h-16 bg-muted rounded-xl" />
        <div className="flex justify-between">
          <div className="h-9 w-20 bg-muted rounded" />
          <div className="h-9 w-36 bg-muted rounded" />
        </div>
      </div>
    </div>
  );
}
