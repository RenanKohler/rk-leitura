import { Card, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-4 pt-2">
      <Skeleton className="h-8 w-40" />
      {[0, 1, 2].map((key) => (
        <Card key={key} className="p-4">
          <Skeleton className="h-5 w-3/4" />
        </Card>
      ))}
    </div>
  );
}
