import { Card, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-4 pt-2">
      <Skeleton className="h-8 w-40" />
      <Card className="space-y-3 p-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-12 w-full rounded-full" />
      </Card>
    </div>
  );
}
