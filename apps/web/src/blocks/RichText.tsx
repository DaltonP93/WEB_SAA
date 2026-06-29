import type { RichTextProps } from "@sa/shared/blocks";

export default function RichText({ html }: RichTextProps) {
  return (
    <section className="container-x py-10">
      <div className="prose max-w-none" dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  );
}
