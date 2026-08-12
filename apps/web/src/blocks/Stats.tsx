import type { StatsProps } from "@sa/shared/blocks";
import LucideIcon, { isIconName } from "../components/LucideIcon";

export default function Stats({ items, heading }: StatsProps) {
  return (
    <section className="container-x section-y-md">
      {heading && <h2 className="text-2xl md:text-3xl font-bold text-center mb-8 text-primary">{heading}</h2>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {items.map((it, i) => (
          <div key={i} className="text-center">
            {it.icon && (
              <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-primary/5 text-primary flex items-center justify-center">
                {isIconName(it.icon) ? (
                  <LucideIcon name={it.icon} className="w-6 h-6" />
                ) : (
                  <span className="text-xl leading-none">{it.icon}</span>
                )}
              </div>
            )}
            <div className="text-3xl md:text-4xl font-bold text-primary">{it.value}</div>
            <div className="text-sm text-gray-600 mt-1">{it.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
