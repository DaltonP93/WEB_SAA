import { Router } from "express";
import { z } from "zod";
import { db } from "../db.js";
import { comparePassword, signToken, requireAuth } from "../auth.js";
import { rateLimit } from "../rate-limit.js";
import { registrarAccion, ipDe } from "../audit.js";
import { capacidadesDe } from "../permisos.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const attempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

// Límite por IP además del contador por IP+email de más abajo: frena el
// barrido de muchos emails distintos desde la misma conexión.
const loginLimiter = rateLimit({
  windowMs: LOGIN_WINDOW_MS,
  max: Number(process.env.LOGIN_RATE_MAX ?? 20),
  message: "Demasiados intentos de acceso. Esperá unos minutos.",
});

authRouter.post("/login", loginLimiter, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "payload invalido" });
  const { email, password } = parsed.data;
  const key = `${req.ip}:${email.toLowerCase()}`;
  const now = Date.now();
  const current = attempts.get(key);
  if (current && current.resetAt > now && current.count >= LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({ error: "demasiados intentos, intente nuevamente mas tarde" });
  }
  const user = await db("users").where({ email }).first();
  if (!user) {
    registerFailedAttempt(key, now);
    await registrarAccion({ actorId: null, actorName: null, actorRole: null, ip: ipDe(req), action: "login_fail", meta: { email } });
    return res.status(401).json({ error: "credenciales invalidas" });
  }
  const ok = await comparePassword(password, user.password_hash);
  if (!ok) {
    registerFailedAttempt(key, now);
    await registrarAccion({ actorId: null, actorName: null, actorRole: null, ip: ipDe(req), action: "login_fail", meta: { email } });
    return res.status(401).json({ error: "credenciales invalidas" });
  }
  attempts.delete(key);
  const payload = { id: user.id, email: user.email, role: user.role, name: user.name };
  const token = signToken(payload);
  await registrarAccion({ actorId: user.id, actorName: user.name, actorRole: user.role, ip: ipDe(req), action: "login_ok" });
  res.json({ token, user: payload });
});

authRouter.get("/me", requireAuth, (req, res) => {
  // Se adjuntan las capacidades derivadas del rol para que el panel oculte lo
  // que la sesión no puede hacer. La autorización real la aplican los
  // middlewares del backend; esto es sólo UX. Se calculan en el servidor (fuente
  // única) y no se decodifican del token, que podría traer un rol ya cambiado.
  res.json({ user: { ...req.user, capabilities: capacidadesDe(req.user?.role) } });
});

function registerFailedAttempt(key: string, now: number) {
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  current.count += 1;
}
