import { useState } from "react";
import { api } from "../api";
import type { ContactFormProps } from "@sa/shared/blocks";

export default function ContactForm({ heading = "Contacto", showPhone = true }: ContactFormProps) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [state, setState] = useState<"idle" | "loading" | "ok" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("loading");
    try {
      await api.post("/public/contact-messages", form);
      setState("ok");
      setForm({ name: "", email: "", phone: "", message: "" });
    } catch {
      setState("error");
    }
  }

  return (
    <section className="container-x py-12">
      <h2 className="text-2xl font-bold mb-6 text-primary">{heading}</h2>
      <form onSubmit={submit} className="grid gap-4 max-w-2xl">
        <div>
          <label htmlFor="contact-name" className="block text-sm font-medium mb-1">Nombre</label>
          <input id="contact-name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="border rounded px-3 py-2 w-full" />
        </div>
        <div>
          <label htmlFor="contact-email" className="block text-sm font-medium mb-1">Email</label>
          <input id="contact-email" required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="border rounded px-3 py-2 w-full" />
        </div>
        {showPhone && (
          <div>
            <label htmlFor="contact-phone" className="block text-sm font-medium mb-1">Teléfono</label>
            <input id="contact-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="border rounded px-3 py-2 w-full" />
          </div>
        )}
        <div>
          <label htmlFor="contact-message" className="block text-sm font-medium mb-1">Mensaje</label>
          <textarea id="contact-message" required rows={4} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="border rounded px-3 py-2 w-full" />
        </div>
        <button disabled={state === "loading"} className="btn-primary self-start">
          {state === "loading" ? "Enviando…" : "Enviar"}
        </button>
        {state === "ok" && <p className="text-green-700">¡Mensaje enviado! Te contactaremos a la brevedad.</p>}
        {state === "error" && <p className="text-red-700">Hubo un error. Intentá nuevamente.</p>}
      </form>
    </section>
  );
}
