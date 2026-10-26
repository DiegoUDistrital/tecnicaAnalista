import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** README tal cual (para los patrones de línea con la bandera m). */
const raw = readFileSync(path.join(root, 'README.md'), 'utf8');
/** README normalizado: minúsculas y espacios colapsados (los textos se parten en líneas). */
const readme = raw.replace(/\s+/g, ' ').toLowerCase();

/** Lenguaje provisional que no debe volver. */
const PROVISIONAL = ['próximamente', 'estado actual', 'se documentará', 'en construcción'];

/**
 * «pendiente» tiene usos legítimos (tareas pendientes, migraciones pendientes): solo se prohíbe como marcador.
 */
const PENDING_MARKERS = [
  /^pendiente\.?$/m,
  /\(pendiente\)/i,
  /pendiente de (comprobar|documentar|redactar)/i,
  /(queda|quedan) pendientes?\b/i,
  /comprobación pendiente/i,
];

/** Frases que afirman cupo por persona o reenvío de la IP desde el frontend. */
const PER_PERSON_QUOTA = [
  'cada persona tiene su cupo',
  'cupo por persona',
  'cupo propio',
  'si el frontend no reenvía la suya',
  'el frontend reenvía la ip',
  'hasta que el frontend envíe',
  'hasta que el frontend reenvíe',
];

/** Documentos que no se suben a git: el README no puede remitir a ellos. */
const UNVERSIONED = ['specs/', 'docs/constitution', 'memory.md', 'claude.md', 'prueba técnica analista.pdf'];

describe('README final: lenguaje provisional y referencias', () => {
  it('RF-R4: el README no contiene lenguaje provisional', () => {
    for (const phrase of PROVISIONAL) expect(readme.includes(phrase), `«${phrase}»`).toBe(false);
  });

  it('RF-R4: «pendiente» solo se prohíbe como marcador provisional', () => {
    for (const pattern of PENDING_MARKERS) expect(raw.match(pattern)?.[0] ?? null, String(pattern)).toBeNull();
  });

  it('RF-R4: no contiene «Este PR deja el paquete del backend preparado»', () => {
    expect(readme.includes('este pr deja el paquete del backend preparado')).toBe(false);
  });

  it('RF-R4: no afirma cupo por persona ni reenvío de IP', () => {
    for (const phrase of PER_PERSON_QUOTA) expect(readme.includes(phrase), `«${phrase}»`).toBe(false);
  });

  it('RF-R4: no remite a archivos no versionados', () => {
    for (const reference of UNVERSIONED) expect(readme.includes(reference), `«${reference}»`).toBe(false);
  });
});

/** @param {string} relative ruta desde la raíz; devuelve el contenido del archivo */
const file = (relative) => readFileSync(path.join(root, relative), 'utf8');

/**
 * @param {string} title título exacto del encabezado (sin las almohadillas)
 * @returns {string} texto del encabezado hasta el siguiente del mismo nivel o superior; vacío si no existe
 */
function section(title) {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => headingLevel(line) > 0 && line.replace(/^#+ /, '') === title);
  if (start === -1) return '';
  const level = headingLevel(lines[start] ?? '');
  const end = lines.findIndex((line, i) => i > start && headingLevel(line) > 0 && headingLevel(line) <= level);
  return lines.slice(start, end === -1 ? undefined : end).join(String.fromCharCode(10));
}

/**
 * @param {string} text texto donde buscar
 * @param {RegExp} pattern expresión con un grupo de captura
 * @returns {string} el grupo capturado; falla si no hay coincidencia
 */
function capture(text, pattern) {
  const found = pattern.exec(text);
  if (!found) throw new Error(String(pattern));
  return found[1] ?? '';
}

/** @param {string} line línea del README; devuelve el nivel del encabezado (0 si no lo es) */
const headingLevel = (line) => (/^(#{1,6}) /.exec(line)?.[1] ?? '').length;

/** Normaliza un texto como el README (minúsculas y espacios colapsados). */
/** @param {string} text */
const norm = (text) => text.replace(/\s+/g, ' ').toLowerCase();

describe('README final: secciones de la entrada', () => {
  it('RF-R4: existen las secciones de resumen y alcance, índice, arranque rápido, arquitectura y estructura', () => {
    for (const title of [
      'Resumen y alcance',
      'Índice',
      'Arranque rápido',
      'Arquitectura',
      'Recorrido de una petición',
      'Estructura del repositorio',
      'Versiones usadas',
    ]) {
      expect(section(title).length, `«${title}»`).toBeGreaterThan(0);
    }
    expect(norm(section('Resumen y alcance')), 'alcance').toContain('fuera de alcance');
    expect(section('Índice'), 'índice con enlaces').toMatch(/\]\(#[a-z0-9áéíóúñ-]+\)/);
  });

  it('RF-R4: el arranque rápido cubre clonar, .env, secretos, up, abrir y down', () => {
    const quick = norm(section('Arranque rápido'));
    for (const piece of [
      'git clone',
      'copy-item .env.example .env',
      'cp .env.example .env',
      'randombytes(24)',
      'randombytes(32)',
      'postgres_password',
      'api_key',
      'rate_limit_max',
      'docker compose -f docker-compose.yml up -d --build --wait',
      'http://127.0.0.1:3001',
      'docker compose -f docker-compose.yml down',
    ]) {
      expect(quick, piece).toContain(piece);
    }
    expect(quick, 'down sin -v').not.toMatch(/docker compose [^`\n]*down -v/);
  });

  it('RF-R4: la arquitectura describe el recorrido de una petición de punta a punta', () => {
    const route = norm(section('Recorrido de una petición'));
    for (const piece of ['navegador', '/api/tasks', 'origen', 'api key', 'express', 'writer', 'postgresql', 'reader']) {
      expect(route, piece).toContain(piece);
    }
  });
});

describe('README final: versiones usadas', () => {
  const versions = norm(section('Versiones usadas'));
  const manifests = ['package.json', 'backend/package.json', 'frontend/package.json'].map((name) =>
    JSON.parse(file(name)),
  );
  const declared = Object.assign({}, ...manifests.flatMap((m) => [m.dependencies ?? {}, m.devDependencies ?? {}]));

  it('RF-R4: «Versiones usadas» coincide con los package.json', () => {
    for (const name of [
      'express',
      'express-rate-limit',
      'helmet',
      'pg',
      'prisma',
      '@prisma/adapter-pg',
      'next',
      'react',
      'react-dom',
      'tailwindcss',
      '@tailwindcss/postcss',
      'postcss',
      'typescript',
      'vitest',
      'eslint',
      'typescript-eslint',
      'prettier',
      'supertest',
      'jsdom',
      '@testing-library/react',
    ]) {
      expect(declared[name], `${name} existe en un package.json`).toBeDefined();
      expect(versions, name).toContain(`${name} ${declared[name]}`);
    }
    expect(versions, 'engines').toContain(manifests[0].engines.node);
  });

  it('RF-R4: «Versiones usadas» coincide con la composición y los Dockerfile', () => {
    const image = capture(file('docker-compose.yml'), /image: (postgres:[\w.]+)/);
    const base = capture(file('backend/Dockerfile'), /FROM (node:[\w.-]+) AS deps/);
    expect(versions, image).toContain(image);
    expect(versions, base).toContain(base);
    expect(versions, 'Compose comprobado').toContain('compose v5.3.1');
    expect(versions, 'Docker comprobado').toContain('docker 29.6.2');
  });
});

describe('README final: ejecución sin contradicciones', () => {
  const execution = ['Arranque rápido', 'Instalación', 'Arranque conjunto', 'Primera vez', 'Cómo ejecutar'];

  it('RF-R4: las secciones de ejecución no se contradicen en puertos', () => {
    for (const title of execution) {
      const ports = new Set(
        section(title)
          .match(/\b(?:127\.0\.0\.1|localhost):(\d+)/g)
          ?.map((m) => m.split(':')[1]),
      );
      for (const port of ports) expect(['3000', '3001', '5433'], `${title}: puerto ${port}`).toContain(port);
    }
    expect(section('Arranque conjunto')).toContain('127.0.0.1:3001');
    expect(section('Arranque rápido')).toContain('127.0.0.1:3001');
    expect(section('Primera vez')).toContain('http://127.0.0.1:3001');
    expect(section('Cómo ejecutar'), 'cómo ejecutar remite al arranque conjunto').toContain('«Arranque conjunto»');
  });

  it('RF-R4: las secciones de ejecución no se contradicen en comandos', () => {
    for (const title of execution) {
      const commands = section(title).match(/docker compose [^\n`]*/g) ?? [];
      for (const command of commands) {
        expect(command, `${title}: ${command}`).toMatch(/-f docker-compose(\.dev)?\.yml/);
        expect(command, `${title}: ${command}`).not.toMatch(/down -v/);
      }
    }
    for (const command of section('Arranque rápido').match(/docker compose [^\n`]*/g) ?? []) {
      expect(command, command).toContain('-f docker-compose.yml');
    }
    for (const title of ['Arranque conjunto', 'Primera vez']) {
      for (const command of section(title).match(/docker compose [^\n`]*/g) ?? []) {
        expect(command, command).toContain('-f docker-compose.dev.yml');
      }
    }
    expect(section('Arranque conjunto')).toContain('npm run dev');
    expect(section('Arranque rápido')).not.toContain('npm run dev');
  });

  it('RF-R4: la base de desarrollo y el despliegue no se presentan como provisionales', () => {
    expect(readme).not.toContain('el despliegue se documenta más adelante');
    expect(readme).not.toContain('se va completando por partes');
    expect(readme).not.toContain('se documentan cuando se añadan');
  });
});

describe('README final: despliegue en Ubuntu y pruebas', () => {
  const ubuntu = norm(section('Despliegue en Ubuntu'));
  const compose = file('docker-compose.yml');

  it('RF-R4: la sección «Despliegue en Ubuntu» existe y contiene «documentados, no probados»', () => {
    expect(ubuntu.length).toBeGreaterThan(0);
    expect(ubuntu).toContain('documentados, no probados');
  });

  it('RF-R4: los requisitos de Ubuntu piden solo Docker (Node y PostgreSQL son imágenes)', () => {
    const requirements = norm(section('Requisitos'));
    for (const piece of [
      'solo hace falta docker',
      'imagen de node',
      'imagen de postgresql',
      'docker compose -f docker-compose.yml up -d --build --wait',
    ]) {
      expect(requirements, piece).toContain(piece);
    }
  });

  it('RF-R4: Ubuntu cubre requisitos, Docker, clonar, .env, up, comprobaciones, actualización, parada y copia', () => {
    for (const piece of [
      'requisitos',
      'docs.docker.com/engine/install/ubuntu',
      'plugin de compose',
      'git clone',
      'cp .env.example .env',
      'randombytes(24)',
      'randombytes(32)',
      'docker compose -f docker-compose.yml up -d --build --wait',
      'docker compose -f docker-compose.yml ps',
      'docker compose -f docker-compose.yml logs',
      'git pull',
      'docker compose -f docker-compose.yml down',
      'pg_dump',
      'tls',
      'login',
      'allowed_hosts',
      'cors_origin',
      'trusted_proxies',
      '127.0.0.1:3001:3001',
    ]) {
      expect(ubuntu, piece).toContain(piece);
    }
    expect(ubuntu, 'sin down -v').not.toMatch(/down -v/);
    expect(ubuntu, 'sin config sin --quiet').not.toMatch(/docker compose [^\n]*\bconfig\b(?! --quiet)/);
    expect(ubuntu, 'sin sudo apt install de versiones').not.toMatch(/docker-ce=/);
  });

  it('RF-R4: los nombres del pg_dump existen en docker-compose.yml', () => {
    const dump = /docker compose -f docker-compose\.yml exec -T (\w+) sh -c '([^']*pg_dump[^']*)'/.exec(
      section('Despliegue en Ubuntu'),
    );
    expect(dump, 'comando pg_dump con exec -T').not.toBeNull();
    const [, service, inner] = dump ?? [];
    expect(compose, `servicio ${service}`).toMatch(new RegExp(`^ {2}${service}:`, 'm'));
    const user = capture(inner ?? '', /-U "\$(\w+)"/);
    const database = capture(inner ?? '', /"\$(\w+)"\s*$/);
    for (const name of [user, database]) expect(compose, `variable ${name}`).toMatch(new RegExp(`^ {6}${name}: `, 'm'));
  });

  const tests = norm(section('Pruebas'));

  it('RF-R4: «Pruebas» tiene la tabla de grupos, comandos, cobertura y nota de E2E', () => {
    expect(section('Pruebas'), 'tabla de grupos').toMatch(/^\| Grupo\s+\| Dónde\s+\| Comando\s+\|/m);
    for (const piece of [
      'npm test',
      'npm run lint',
      'npm run typecheck',
      'npm run build',
      'npm run test:integration',
      '95 %',
      'extremo a extremo',
      'no hay un comando',
    ]) {
      expect(tests, piece).toContain(piece);
    }
  });

  it('RF-R4: «Pruebas» declara 10 de 20 pasos manuales ejecutados y nombra los no ejecutados', () => {
    expect(tests).toContain('4 cumple, 6 parcial y 10 no ejecutado');
    expect(tests).toContain('10 de los 20 pasos');
    expect(tests).toContain('2, 5, 6, 8, 9, 12, 13, 16, 18 y 19');
    expect(tests).toContain('6, 8 y 16');
  });

  it('RF-R4: la lista manual sigue con sus 20 pasos', () => {
    const steps = [...section('Comprobación manual').matchAll(/^(\d+)\. \*\*/gm)].map((m) => Number(m[1]));
    expect(steps).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
    expect(section('Comprobación manual')).toContain('| Paso | Qué se comprueba | Resultado | Observación |');
  });
});

describe('README final: decisiones, riesgos y trabajo futuro', () => {
  const decisions = section('Decisiones técnicas');
  /** Bloques `### D<n>. título` de la sección, con el título en minúsculas. */
  const blocks = decisions
    .split(/^(?=### D\d+\. )/m)
    .filter((block) => block.startsWith('### D'))
    .map((block) => ({ title: norm(block.split(/\r?\n/)[0] ?? '').replaceAll('`', ''), body: block }));

  it('RF-R4: cada decisión tiene decisión, porqué y alternativa descartada', () => {
    const required = [
      'monorepo',
      'solo express',
      'tres roles',
      'vista de conteos',
      'prisma',
      'pg y pool',
      'server actions',
      'api key',
      'rate limiting',
      'cupo compartido',
      'defensa de origen',
      'redis',
      'login',
      'índice',
      'despliegue',
    ];
    for (const keyword of required) {
      expect(
        blocks.some((b) => b.title.includes(keyword)),
        `decisión «${keyword}»`,
      ).toBe(true);
    }
    expect(blocks.length, 'decisiones numeradas').toBeGreaterThanOrEqual(required.length);
    for (const block of blocks) {
      for (const label of ['- **Decisión:** ', '- **Porqué:** ', '- **Alternativa descartada:** ']) {
        expect(block.body, `${block.title}: ${label}`).toContain(label);
      }
    }
  });

  it('RF-R4: el despliegue recoge etiquetas, standalone, red interna, owner y el código 143', () => {
    const deploy = norm(blocks.find((b) => b.title.includes('despliegue'))?.body ?? '');
    for (const piece of [
      'etiqueta',
      'node:26.1.0-bookworm-slim',
      'postgres:16.15',
      'standalone',
      'red interna',
      'owner',
      'cap_drop',
      'no-new-privileges',
      '143',
    ]) {
      expect(deploy, piece).toContain(piece);
    }
  });

  it('RF-R4: una sola sección «Riesgos residuales y limitaciones» con los riesgos que el proyecto asume', () => {
    const headings = raw.split(/\r?\n/).filter((line) => /^#{1,6} .*riesgos residuales/i.test(line));
    expect(headings, 'un solo encabezado').toEqual(['## Riesgos residuales y limitaciones']);
    const risks = norm(section('Riesgos residuales y limitaciones'));
    for (const piece of [
      'cupo compartido',
      'sin login',
      'ubuntu',
      'documentados, no probados',
      '4 cumple, 6 parcial y 10 no ejecutado',
      '2, 5, 6, 8, 9, 12, 13, 16, 18 y 19',
      'https',
      'ventana fija',
      'memoria',
    ]) {
      expect(risks, piece).toContain(piece);
    }
    expect(readme, 'sin la fórmula contradictoria').not.toContain('10 de 20 ejecutados');
    expect(norm(section('Despliegue en Ubuntu')), 'Ubuntu enlaza la sección').toContain(
      '«riesgos residuales y limitaciones»',
    );
  });

  it('RF-R4: existe «Trabajo futuro» (con Redis)', () => {
    const future = norm(section('Trabajo futuro'));
    expect(future).toContain('redis');
    expect(future).toContain('login');
    expect(future).toContain('https');
  });

  it('RF-R4: las decisiones o) y p) están separadas por una línea en blanco', () => {
    expect(raw).not.toMatch(/\n\*\*[a-z]\) [^\n]*\n\*\*[a-z]\) /);
    expect(raw).not.toMatch(/\n(?:- )?\*\*Decisión:\*\*[^\n]*\n\*\*D\d/);
  });
});

/** Ancla de un encabezado como la calcula GitHub: minúsculas, sin signos, espacios por guiones. */
/** @param {string} title */
const anchorOf = (title) =>
  title
    .replaceAll('`', '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');

/** Líneas dentro de bloques de código con su texto. */
const codeLines = (() => {
  const lines = [];
  let inside = false;
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*```/.test(line)) inside = !inside;
    else if (inside) lines.push(line);
  }
  return lines;
})();

describe('README final: verificación final', () => {
  it('RF-R4: todos los enlaces del índice apuntan a un encabezado existente', () => {
    const anchors = new Set();
    const seen = new Map();
    let fenced = false;
    for (const line of raw.split(/\r?\n/)) {
      if (/^\s*```/.test(line)) fenced = !fenced;
      if (fenced || headingLevel(line) === 0) continue;
      const base = anchorOf(line.replace(/^#+ /, ''));
      const count = seen.get(base) ?? 0;
      seen.set(base, count + 1);
      anchors.add(count === 0 ? base : `${base}-${count}`);
    }
    const links = [...section('Índice').matchAll(/\]\(#([^)]+)\)/g)].map((m) => m[1]);
    expect(links.length, 'el índice tiene enlaces').toBeGreaterThan(10);
    for (const link of links) expect(anchors.has(link ?? ''), `#${link}`).toBe(true);
  });

  it('RF-R4: ningún comando documentado imprime .env y docker compose config lleva siempre --quiet', () => {
    const printsEnv = /(?:\b(?:cat|type|more|less|head|tail|printenv)\s+|Get-Content\s+)[^\n|;]*\.env\b/;
    for (const line of codeLines.filter((l) => printsEnv.test(l))) {
      const safe = /Set-Content|^\s*\$\w+\s*=/.test(line);
      expect(safe, `imprime .env: ${line.trim()}`).toBe(true);
    }
    for (const line of codeLines.filter((l) => /docker compose\b.*\bconfig\b/.test(l))) {
      expect(line, line.trim()).toContain('config --quiet');
    }
    for (const match of raw.matchAll(/docker compose [^\n`]*\bconfig\b[^\n`]*/g)) {
      expect(match[0], match[0]).toContain('--quiet');
    }
    const dumps = [
      /\bdocker inspect (?!-f |--format )/,
      /\bprintenv\s*$/,
      /\bprintenv\b.*(?:PASSWORD|API_KEY|DATABASE_URL)/,
      /(?<![.\w])env\s*$/,
    ];
    for (const line of codeLines) for (const dump of dumps) expect(line, line.trim()).not.toMatch(dump);
  });

  it('RF-R4: no hay contraseñas, URL de conexión ni keys reales (solo valores de ejemplo)', () => {
    expect(raw, 'URL con usuario y contraseña').not.toMatch(/[a-z]+:\/\/[^\s/@`]+:[^\s/@`]+@/);
    const example = new Set(['.*', 'change-me', 'change-me-use-randomBytes-32', 'contrasena-falsa-123']);
    for (const m of raw.matchAll(/\b[A-Z_]*(?:PASSWORD|API_KEY|SECRET|TOKEN)\s*=\s*([^\s'"`]+)/g)) {
      const value = (m[1] ?? '').replace(/[.,;)]+$/, '');
      expect(value === '' || value.startsWith('*') || example.has(value), `${m[0]}`).toBe(true);
    }
    expect(raw, 'claves largas en hexadecimal o base64').not.toMatch(
      /\b[0-9a-f]{32,}\b|(?<![\w/.-])(?=[A-Za-z_-]*\d)(?=[A-Za-z0-9_-]*[A-Z])[A-Za-z0-9_-]{43}(?![\w/.-])/,
    );
  });
});
