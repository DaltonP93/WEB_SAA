type SkeletonVariant = "card" | "list" | "compact";

interface Props {
  variant?: SkeletonVariant;
  count?: number;
  className?: string;
}

function SkeletonItem({ variant }: { variant: SkeletonVariant }) {
  if (variant === "list") {
    return (
      <div className="bg-white rounded shadow p-4 animate-pulse">
        <div className="flex gap-3">
          <div className="w-16 h-16 rounded bg-gray-200 flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="h-3 bg-gray-200 rounded w-1/3" />
            <div className="h-3 bg-gray-100 rounded w-1/2" />
          </div>
        </div>
      </div>
    );
  }
  if (variant === "compact") {
    return (
      <div className="bg-white rounded shadow p-5 text-center animate-pulse">
        <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-200" />
        <div className="h-3 bg-gray-200 rounded w-3/4 mx-auto" />
      </div>
    );
  }
  return (
    <div className="bg-white rounded shadow p-4 animate-pulse flex flex-col">
      <div className="aspect-square mb-3 rounded bg-gray-200" />
      <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
      <div className="h-3 bg-gray-100 rounded w-1/2 mb-3" />
      <div className="h-8 bg-gray-100 rounded mt-auto" />
    </div>
  );
}

export default function SkeletonCard({ variant = "card", count = 4, className = "" }: Props) {
  return (
    <div className={`grid gap-5 ${className}`}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonItem key={i} variant={variant} />
      ))}
    </div>
  );
}
