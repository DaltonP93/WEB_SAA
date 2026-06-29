import { lazy, Suspense, useMemo, type ComponentType } from "react";
import dynamicIconImports from "lucide-react/dynamicIconImports";

type IconImporter = () => Promise<{ default: ComponentType<{ className?: string }> }>;
const imports = dynamicIconImports as unknown as Record<string, IconImporter>;

export function isIconName(value: string): boolean {
  return /^[a-z][a-z0-9-]*$/.test(value) && value in imports;
}

export default function LucideIcon({ name, className = "w-5 h-5" }: { name: string; className?: string }) {
  const Icon = useMemo(() => {
    const importer = imports[name];
    return importer ? lazy(importer) : null;
  }, [name]);
  if (!Icon) return null;
  return (
    <Suspense fallback={<span className={className} />}>
      <Icon className={className} />
    </Suspense>
  );
}
