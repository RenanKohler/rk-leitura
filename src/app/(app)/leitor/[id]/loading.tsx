import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="pt-safe border-b border-border px-4 py-3">
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-2 h-3 w-24" />
      </header>
      <div className="flex-1 space-y-3 px-5 py-8">
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <Skeleton key={i} className="h-5 w-full" />
        ))}
      </div>
    </div>
  );
}
