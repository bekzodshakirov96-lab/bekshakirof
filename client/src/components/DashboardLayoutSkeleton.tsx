import { Skeleton } from "./ui/skeleton";

export function DashboardLayoutSkeleton() {
  return (
    <div className="flex min-h-screen bg-background" role="status" aria-label="Tizim yuklanmoqda">
      <div className="hidden w-[17rem] shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex" aria-hidden="true">
        <div className="flex h-16 items-center gap-2.5 border-b border-sidebar-border px-4">
          <Skeleton className="h-9 w-9 rounded-lg bg-sidebar-accent" />
          <div className="space-y-2">
            <Skeleton className="h-3.5 w-28 bg-sidebar-accent" />
            <Skeleton className="h-2.5 w-20 bg-sidebar-accent" />
          </div>
        </div>
        <div className="flex-1 space-y-5 px-3 py-5">
          {[3, 4, 3].map((count, group) => (
            <div key={group} className="space-y-2">
              <Skeleton className="mb-3 ml-2 h-2 w-16 bg-sidebar-accent" />
              {Array.from({ length: count }, (_, item) => (
                <Skeleton key={item} className="h-8 w-full rounded-md bg-sidebar-accent" />
              ))}
            </div>
          ))}
        </div>
        <div className="space-y-3 border-t border-sidebar-border p-3">
          <div className="flex gap-2">
            <Skeleton className="h-8 flex-1 rounded-md bg-sidebar-accent" />
            <Skeleton className="h-8 flex-1 rounded-md bg-sidebar-accent" />
          </div>
          <div className="flex items-center gap-2.5 px-1.5">
            <Skeleton className="h-8 w-8 rounded-lg bg-sidebar-accent" />
            <div className="space-y-2">
              <Skeleton className="h-3 w-24 bg-sidebar-accent" />
              <Skeleton className="h-2 w-16 bg-sidebar-accent" />
            </div>
          </div>
        </div>
      </div>

      <div className="min-w-0 flex-1" aria-hidden="true">
        <div className="flex h-16 items-center justify-between gap-4 border-b border-border bg-card px-4 md:px-6">
          <div className="flex items-center gap-3">
            <Skeleton className="h-8 w-8 rounded-md" />
            <Skeleton className="h-3.5 w-36" />
          </div>
          <Skeleton className="hidden h-7 w-24 rounded-md sm:block" />
        </div>
        <div className="space-y-6 p-4 md:p-6">
          <div className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {[0, 1, 2, 3].map(item => (
              <div key={item} className="space-y-4 rounded-xl border border-border bg-card p-5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-2.5 w-20" />
              </div>
            ))}
          </div>
          <div className="space-y-5 rounded-xl border border-border bg-card p-5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-9 w-full rounded-md" />
            {[0, 1, 2, 3, 4].map(row => (
              <div key={row} className="flex items-center gap-6 border-b border-border pb-4 last:border-0 last:pb-0">
                <Skeleton className="h-3 w-1/3" />
                <Skeleton className="h-3 flex-1" />
                <Skeleton className="h-3 w-1/5" />
              </div>
            ))}
          </div>
        </div>
      </div>
      <span className="sr-only">Tizim yuklanmoqda...</span>
    </div>
  );
}
