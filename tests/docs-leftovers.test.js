import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} relative ruta desde la raíz del repositorio
 * @returns {string} contenido normalizado: minúsculas y espacios en blanco colapsados (los textos del README se
 * parten en líneas)
 */
function read(relative) {
  return readFileSync(path.join(root, relative), 'utf8').replace(/\s+/g, ' ').toLowerCase();
}

const readme = read('README.md');
const envExamples = { '.env.example': read('.env.example'), 'frontend/.env.example': read('frontend/.env.example') };

/** Frases que prometían reenviar la IP real o que describían el cupo de otra manera. */
const RETIRED_PHRASES = [
  'cupo compartido hasta la 007',
  'todavía no se envía',
  'despliegue (pendiente)',
  'hasta que el frontend envíe',
  'hasta que el frontend reenvíe',
  'cada persona tiene su cupo y el frontend no consume el de todos',
  'subred fija',
  'contrato para el frontend',
  'debe pasar la ip del usuario',
  'sin conocer la ip real',
  've siempre la ip del servidor del frontend',
  'debe incluir la red desde la que se conecta el servidor del frontend',
  'bloquea la ip del frontend',
];

/**
 * @param {string} text texto ya normalizado
 * @param {string[]} phrases
 */
function expectAll(text, phrases) {
  for (const phrase of phrases) expect(text, phrase).toContain(phrase.toLowerCase());
}

describe('documentación de la 007 (README y .env.example)', () => {
  it('RF-I9: ni README.md ni .env.example ni frontend/.env.example contienen las frases retiradas', () => {
    const files = { 'README.md': readme, ...envExamples };
    for (const [name, text] of Object.entries(files)) {
      for (const phrase of RETIRED_PHRASES) expect(text.includes(phrase), `${name}: «${phrase}»`).toBe(false);
    }
  });

  it('RF-I9: el README documenta npm run dev y la primera vez', () => {
    expectAll(readme, [
      '## arranque conjunto',
      'npm run dev',
      '### primera vez',
      'copy-item .env.example .env',
      'copy-item frontend/.env.example frontend/.env',
      'misma `api_key`',
      'randombytes(32)',
      'npm ci',
      'docker compose -f docker-compose.dev.yml up -d --wait',
      'npm run db:deploy',
      'prisma db pull',
      '[db]',
      '[backend]',
      '[frontend]',
      'no instala',
      'no migra',
      'down -v',
    ]);
  });

  it('RF-I9: el README tiene la sección del cupo compartido (porqué, alternativas, riesgo y proxy)', () => {
    expectAll(readme, [
      '## cupo compartido por diseño (desviación declarada)',
      'alternativas descartadas',
      'riesgo aceptado',
      'servidor node propio',
      'proxy de confianza',
      'rate_limit_max',
      'rate_limit_post_max',
    ]);
  });

  it('RF-I9: el README explica TRUSTED_PROXIES con loopback y con none, y los avisos de plataforma', () => {
    expectAll(readme, [
      '`trusted_proxies`',
      '`loopback` por defecto',
      '`trusted_proxies=none`',
      'taskkill',
      '`next build`',
      '`next dev`',
      'sin login',
      'no exponer',
    ]);
  });

  it('RF-I4: el README dice que el frontend nunca envía cabeceras de IP y que todos comparten el cupo', () => {
    expectAll(readme, [
      'nunca envía `x-forwarded-for` ni otra cabecera de ip',
      'todos los usuarios comparten el cupo',
      'la ip no aparece en respuestas ni en registros del frontend',
    ]);
  });

  it('RF-I9: los .env.example conservan las palabras que exigen los tests y explican el cupo compartido', () => {
    const root_ = envExamples['.env.example'];
    expectAll(root_, ['loopback', 'x-forwarded-for', 'cupo compartido']);
    expect(envExamples['frontend/.env.example']).toContain('todos los usuarios');
  });
});
