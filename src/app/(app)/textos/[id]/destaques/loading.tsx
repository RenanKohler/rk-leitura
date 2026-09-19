import { Card, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 px-4 py-6">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-11 w-full rounded-full" />
      {[0, 1, 2].map((key) => (
        <Card key={key} className="space-y-2 p-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
        </Card>
      ))}
    </div>
  );
}
