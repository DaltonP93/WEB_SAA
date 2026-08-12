export type SocialKind = "facebook" | "instagram" | "youtube" | "linkedin" | "whatsapp";

/** Iconos de marca (lucide no incluye logos de redes). */
export default function SocialIcon({ kind, className = "w-4 h-4" }: { kind: SocialKind; className?: string }) {
  switch (kind) {
    case "facebook":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
          <path d="M22 12.06C22 6.5 17.52 2 12 2S2 6.5 2 12.06c0 5 3.66 9.14 8.44 9.94v-7.03H7.9v-2.91h2.54V9.85c0-2.51 1.49-3.89 3.77-3.89 1.09 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.87h2.78l-.44 2.91h-2.34V22c4.78-.8 8.44-4.94 8.44-9.94z" />
        </svg>
      );
    case "instagram":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="5" />
          <circle cx="12" cy="12" r="4" />
          <circle cx="17.5" cy="6.5" r="1" fill="currentColor" />
        </svg>
      );
    case "youtube":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
          <path d="M23.5 6.2a3 3 0 00-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 00.5 6.2C0 8.1 0 12 0 12s0 3.9.5 5.8a3 3 0 002.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 002.1-2.1c.5-1.9.5-5.8.5-5.8s0-3.9-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z" />
        </svg>
      );
    case "linkedin":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
          <path d="M20.45 20.45h-3.55v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.36V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 11.01-4.12 2.06 2.06 0 010 4.12zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.56C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.72V1.72C24 .77 23.2 0 22.22 0z" />
        </svg>
      );
    case "whatsapp":
      return (
        <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
          <path d="M20.52 3.48A11.84 11.84 0 0 0 12.05 0C5.5 0 .17 5.32.17 11.86c0 2.09.55 4.13 1.6 5.93L0 24l6.36-1.66a11.86 11.86 0 0 0 5.69 1.45h.01c6.55 0 11.88-5.32 11.88-11.86 0-3.17-1.24-6.15-3.41-8.45zM12.06 21.4h-.01a9.65 9.65 0 0 1-4.92-1.35l-.35-.21-3.78.99 1.01-3.68-.23-.38a9.61 9.61 0 0 1-1.48-5.11c0-5.31 4.34-9.63 9.67-9.63 2.58 0 5.01 1 6.84 2.83a9.55 9.55 0 0 1 2.83 6.82c0 5.32-4.33 9.72-9.58 9.72zm5.53-7.27c-.3-.15-1.79-.88-2.07-.98-.28-.1-.48-.15-.69.15s-.79.98-.97 1.18c-.18.2-.36.22-.66.07-.3-.15-1.27-.47-2.42-1.5-.89-.79-1.49-1.77-1.67-2.07-.18-.3-.02-.46.13-.61.13-.13.3-.36.45-.54.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.07-.15-.66-1.6-.91-2.19-.24-.58-.49-.5-.67-.5l-.57-.01c-.2 0-.53.07-.81.38-.28.3-1.06 1.03-1.06 2.52 0 1.48 1.09 2.92 1.24 3.12.15.2 2.14 3.27 5.19 4.58.73.31 1.29.5 1.73.64.73.23 1.39.2 1.91.12.58-.09 1.79-.73 2.04-1.43.25-.7.25-1.31.18-1.43-.08-.13-.28-.2-.58-.35z" />
        </svg>
      );
  }
}
