import { Router } from "express";
import { requireAuth, requirePermisoPorMetodo } from "../../auth.js";
import type { Capacidad } from "../../permisos.js";
import { settingsRouter } from "./settings.js";
import { pagesRouter } from "./pages.js";
import { doctorsRouter } from "./doctors.js";
import { specialtiesRouter } from "./specialties.js";
import { servicesRouter } from "./services.js";
import { studiesRouter } from "./studies.js";
import { menusRouter } from "./menus.js";
import { appointmentsRouter } from "./appointments.js";
import { contactMessagesRouter } from "./contact_messages.js";
import { contactChannelsRouter } from "./contact_channels.js";
import { schedulesRouter } from "./schedules.js";
import { dataReadinessRouter } from "./data_readiness.js";
import { dataConfirmationsRouter } from "./data_confirmations.js";
import { mediaRouter } from "./media.js";
import { usersRouter } from "./users.js";
import { redirectsRouter } from "./redirects.js";
import { newsletterRouter } from "./newsletter.js";
import { auditRouter } from "./audit.js";

export const adminRouter = Router();
adminRouter.use(requireAuth);

/**
 * Mapa de autorización del panel, en un solo lugar y auditable de un vistazo.
 *
 * Cada router se monta con `requirePermisoPorMetodo`, que exige la capacidad
 * según el método (GET→read, POST/PUT→write, DELETE→delete) y **deniega por
 * defecto** un método sin capacidad declarada. Los routers de contenido usan el
 * grupo `CONTENT`; los de bandeja/leads, `LEADS`; los ajustes, `SETTINGS`;
 * usuarios exige `users.manage` (superadmin) y la bitácora `audit.read`.
 *
 * La granularidad fina de publicar-vs-editar en páginas (autor no publica) se
 * refuerza además dentro de `pages.ts` con `content.publish` sobre las acciones
 * que cambian el estado, porque no se distingue por método HTTP.
 */
type MetodoCaps = { read?: Capacidad; write?: Capacidad; delete?: Capacidad };
const CONTENT: MetodoCaps = { read: "content.read", write: "content.write", delete: "content.delete" };
const LEADS: MetodoCaps = { read: "leads.read", write: "leads.write", delete: "leads.write" };
const SETTINGS: MetodoCaps = { read: "settings.read", write: "settings.write", delete: "settings.write" };
const perm = requirePermisoPorMetodo;

adminRouter.use("/settings", perm(SETTINGS), settingsRouter);
adminRouter.use("/pages", perm(CONTENT), pagesRouter);
adminRouter.use("/doctors", perm(CONTENT), doctorsRouter);
adminRouter.use("/specialties", perm(CONTENT), specialtiesRouter);
adminRouter.use("/services", perm(CONTENT), servicesRouter);
adminRouter.use("/studies", perm(CONTENT), studiesRouter);
adminRouter.use("/menus", perm(CONTENT), menusRouter);
adminRouter.use("/appointments", perm(LEADS), appointmentsRouter);
adminRouter.use("/contact-messages", perm(LEADS), contactMessagesRouter);
adminRouter.use("/contact-channels", perm(CONTENT), contactChannelsRouter);
adminRouter.use("/schedules", perm(CONTENT), schedulesRouter);
adminRouter.use("/data-readiness", perm({ read: "content.read" }), dataReadinessRouter);
adminRouter.use(
  "/data-confirmations",
  perm({ read: "content.read", write: "data.confirm", delete: "data.confirm" }),
  dataConfirmationsRouter,
);
adminRouter.use("/media", perm(CONTENT), mediaRouter);
adminRouter.use("/users", perm({ read: "users.manage", write: "users.manage", delete: "users.manage" }), usersRouter);
adminRouter.use("/redirects", perm(CONTENT), redirectsRouter);
adminRouter.use("/newsletter", perm(LEADS), newsletterRouter);
adminRouter.use("/audit", perm({ read: "audit.read" }), auditRouter);
