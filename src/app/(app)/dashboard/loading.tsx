import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-6">
      <header className="pt-2">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-60" />
      </header>
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-28 w-full rounded-card" />
        ))}
      </section>
      <Skeleton className="h-36 w-full rounded-card" />
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 w-full rounded-card" />
        ))}
      </div>
    </div>
  );
}
