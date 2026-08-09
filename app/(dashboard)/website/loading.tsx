// Two cards, not five. A partner sees only branding + Public Listing — the web
// address, Appearance and Social links cards are all owner-only — and loading.tsx
// cannot know the role. A skeleton shorter than the page settles by growing;
// one 2.5x too tall collapses under the reader.
export default function WebsiteLoading() {
  return (
    <div className="space-y-6 max-w-2xl">
      <div className="h-8 w-32 bg-muted rounded animate-pulse" />
      <div className="h-64 bg-muted rounded-lg animate-pulse" />
      <div className="h-px bg-muted" />
      <div className="h-96 bg-muted rounded-lg animate-pulse" />
    </div>
  );
}
