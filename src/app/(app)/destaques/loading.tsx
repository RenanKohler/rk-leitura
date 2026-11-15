import { Card, Skeleton } from "@/components/ui";

export default function Loading() {
  return (
    <div className="space-y-5">
      <header className="pt-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="mt-2 h-4 w-44" />
      </header>
      <Skeleton className="h-14 w-full" />
      <div className="space-y-2">
        <Skeleton className="h-6 w-2/3" />
        {[0, 1, 2].map((key) => (
          <Card key={key} className="space-y-2 p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-4/5" />
          </Card>
        ))}
      </div>
    </div>
  );
}
