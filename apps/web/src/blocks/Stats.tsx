import type { StatsProps } from "@sa/shared/blocks";

export default function Stats({ items }: StatsProps) {
  return (
    <section className="container-x py-12">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
        {items.map((it, i) => (
          <div key={i} className="text-center">
            <div className="text-3xl md:text-4xl font-bold text-primary">{it.value}</div>
            <div className="text-sm text-gray-600 mt-1">{it.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
