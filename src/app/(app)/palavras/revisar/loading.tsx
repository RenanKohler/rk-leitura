import { Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-5 pt-2">
      <Skeleton className="h-9 w-48" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
