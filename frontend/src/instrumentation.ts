import { PHASE_PRODUCTION_BUILD } from 'next/constants';

/**
 * Gancho de arranque de Next: valida la configuración al iniciar `dev`/`start`. Solo actúa en el servidor de Node y
 * nunca durante `next build`. La importación dinámica evita que el paquete de `edge` arrastre módulos del servidor.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NEXT_PHASE !== PHASE_PRODUCTION_BUILD) {
    const { validateStartupConfig } = await import('./server/config/startup');
    validateStartupConfig();
  }
}
