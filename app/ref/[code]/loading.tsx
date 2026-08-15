export default function Loading() {
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-sidebar-border bg-sidebar/90 backdrop-blur-md">
        <div className="max-w-lg mx-auto px-4 h-14 flex items-center gap-3 animate-pulse">
          <div className="w-8 h-8 rounded-lg bg-white/5" />
          <div className="h-4 w-40 bg-white/5 rounded" />
        </div>
      </div>
      <div className="max-w-lg mx-auto px-4 py-10 space-y-4 animate-pulse">
        <div className="h-9 w-56 bg-white/5 rounded-lg" />
        <div className="h-4 w-72 bg-white/5 rounded" />
        <div className="h-52 bg-white/5 rounded-2xl" />
        <div className="h-11 bg-white/5 rounded-xl" />
      </div>
    </div>
  );
}
