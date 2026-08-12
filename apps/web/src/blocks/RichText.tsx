import type { RichTextProps } from "@sa/shared/blocks";

export default function RichText({ html }: RichTextProps) {
  return (
    <section className="container-x section-y-sm">
      <div className="prose max-w-none leading-relaxed overflow-x-auto" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
