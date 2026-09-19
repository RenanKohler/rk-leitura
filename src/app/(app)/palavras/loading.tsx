import { Card, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-4 pt-2">
      <Skeleton className="h-8 w-44" />
      {[0, 1, 2].map((key) => (
        <Card key={key} className="space-y-2 p-4">
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-4 w-full" />
        </Card>
      ))}
    </div>
  );
}
