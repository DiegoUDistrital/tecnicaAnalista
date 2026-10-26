import path from 'node:path';
import { BACKEND_PORT, FRONTEND_PORT, LOOPBACK } from './commands.js';

/**
 * Comprueba que existen los archivos y carpetas que el arranque necesita (sin leer su contenido).
 * @param {{ root: string, fileExists: (file: string) => boolean }} options
 * @returns {string[]} un mensaje por cada carencia, con lo que hay que instalar o copiar
 */
export function findMissingFiles({ root, fileExists }) {
  const has = (/** @type {string[]} */ ...parts) => fileExists(path.join(root, ...parts));
  const problems = [];
  if (!has('.env')) problems.push('Falta el archivo .env de la raíz: copie .env.example a .env');
  if (!has('frontend', '.env')) {
    problems.push('Falta el archivo frontend/.env: copie frontend/.env.example a frontend/.env');
  }
  if (!has('backend', 'node_modules')) {
    problems.push('Faltan las dependencias del backend: ejecute `npm install` en backend/');
  }
  if (!has('frontend', 'node_modules')) {
    problems.push('Faltan las dependencias del frontend: ejecute `npm install` en frontend/');
  }
  return problems;
}

/**
 * Comprueba que los puertos fijos del backend y del frontend están libres.
 * @param {{ isPortFree: (port: number, host: string) => Promise<boolean> }} options
 * @returns {Promise<string[]>} un mensaje por cada puerto ocupado
 */
export async function findBusyPorts({ isPortFree }) {
  const problems = [];
  for (const port of [BACKEND_PORT, FRONTEND_PORT]) {
    if (await isPortFree(port, LOOPBACK)) continue;
    problems.push(`El puerto ${port} está ocupado: libérelo antes de arrancar`);
  }
  return problems;
}
