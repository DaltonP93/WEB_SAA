import { useMemo } from "react";
import { lazy, Suspense } from "react";
import dynamicIconImports from "lucide-react/dynamicIconImports";

type IconImporter = () => Promise<{ default: React.ComponentType<{ className?: string }> }>;
const imports = dynamicIconImports as unknown as Record<string, IconImporter>;

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl" | "full";

interface Props {
  src?: string | null;
  alt: string;
  size?: AvatarSize;
  iconName?: string;
  className?: string;
  rounded?: boolean;
}

const SIZE_CLASSES: Record<AvatarSize, string> = {
  xs: "w-8 h-8 text-xs",
  sm: "w-10 h-10 text-sm",
  md: "w-12 h-12 text-base",
  lg: "w-16 h-16 text-xl",
  xl: "w-24 h-24 text-3xl",
  full: "w-full h-full text-3xl",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const AVATAR_PALETTE = [
  "bg-primary/15 text-primary",
  "bg-secondary/20 text-secondary-800",
  "bg-accent/15 text-accent-700",
  "bg-primary-100 text-primary-800",
  "bg-secondary-100 text-secondary-800",
  "bg-accent-100 text-accent-800",
  "bg-primary-200 text-primary-900",
  "bg-secondary-200 text-secondary-900",
];

function hashColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(h) % AVATAR_PALETTE.length];
}

function PlaceholderIcon({ name, className }: { name: string; className: string }) {
  const Importer = imports[name];
  const Icon = useMemo(() => (Importer ? lazy(Importer) : null), [name]);
  if (!Icon) return null;
  return (
    <Suspense fallback={null}>
      <Icon className={className} />
    </Suspense>
  );
}

export default function Avatar({
  src,
  alt,
  size = "md",
  iconName,
  className = "",
  rounded = true,
}: Props) {
  const base = SIZE_CLASSES[size];
  const shape = rounded ? "rounded-full" : "rounded";

  if (src) {
    return (
      <div className={`${base} ${shape} overflow-hidden bg-gray-100 flex-shrink-0 ${className}`}>
        <img src={src} alt={alt} loading="lazy" decoding="async" className="w-full h-full object-cover" />
      </div>
    );
  }

  if (iconName) {
    return (
      <div
        className={`${base} ${shape} bg-primary/10 text-primary flex items-center justify-center font-semibold flex-shrink-0 ${className}`}
        aria-label={alt}
      >
        <PlaceholderIcon name={iconName} className="w-1/2 h-1/2" />
      </div>
    );
  }

  return (
    <div
      className={`${base} ${shape} ${hashColor(alt)} flex items-center justify-center font-semibold flex-shrink-0 ${className}`}
      aria-label={alt}
    >
      {initials(alt)}
    </div>
  );
}

export { initials };
