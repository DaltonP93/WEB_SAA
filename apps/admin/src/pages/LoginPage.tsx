import { useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { api } from "../api";

export default function LoginPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("admin@sanatorio.local");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem("token", data.token);
      nav("/");
    } catch (err: any) {
      toast.error(err.response?.data?.error ?? "Error de login");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-brand to-brand2">
      <form onSubmit={submit} className="bg-white rounded shadow-xl p-8 w-full max-w-sm">
        <h1 className="text-xl font-bold text-brand mb-1">Panel de administración</h1>
        <p className="text-sm text-gray-500 mb-6">Sanatorio Adventista</p>
        <label className="label">Email</label>
        <input className="input mb-4" value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
        <label className="label">Contraseña</label>
        <input className="input mb-6" value={password} onChange={(e) => setPassword(e.target.value)} type="password" required />
        <button disabled={loading} className="btn-primary w-full">{loading ? "Ingresando…" : "Ingresar"}</button>
      </form>
    </div>
  );
}
