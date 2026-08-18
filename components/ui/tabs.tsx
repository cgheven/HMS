"use client";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

function TabsList({
  className,
  noFade,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List> & {
  /** Suppress the scroll-hint fades. Set this when the strip is laid out to fit
   *  (e.g. a full-width grid on mobile): with nothing to scroll, the fades wash
   *  out the first and last tab and the strip reads as clipped instead. */
  noFade?: boolean;
}) {
  return (
    <div className="relative max-w-full">
      <TabsPrimitive.List
        className={cn(
          "inline-flex items-center gap-0.5 rounded-lg bg-white/5 border border-sidebar-border p-1",
          "max-w-full overflow-x-auto scrollbar-hide",
          className
        )}
        {...props}
      />
      {/* Edge fades hint that the tab strip scrolls horizontally when it overflows */}
      {!noFade && (
        <>
          <div className="md:hidden pointer-events-none absolute inset-y-0 left-0 w-5 bg-gradient-to-r from-background to-transparent rounded-l-lg" />
          <div className="md:hidden pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-background to-transparent rounded-r-lg" />
        </>
      )}
    </div>
  );
}

function TabsTrigger({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-all shrink-0",
        "text-muted-foreground hover:text-foreground",
        "data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        "disabled:pointer-events-none disabled:opacity-50",
        className
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("mt-4 focus-visible:outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
