import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { interpolate, referencedVariables } from '../helpers/compose-interpolation';
import { readRepoText, repoRoot } from '../helpers/repo-files';

// Pruebas estáticas del docker-compose.yml de despliegue: leen el archivo como texto y no usan Docker.
// Para no imprimir contraseñas con `docker compose config`, el archivo se interpola con el interpolador propio.

interface Service {
  image?: string;
  build?: { context: string; target: string };
  environment?: Record<string, string>;
  env_file?: unknown;
  ports?: string[];
  networks?: string[];
  depends_on?: Record<string, { condition: string }>;
  healthcheck?: { test: string[]; interval?: string; timeout?: string; retries?: number; start_period?: string };
  volumes?: string[];
}
interface Compose {
  name?: string;
  services: Record<string, Service>;
  networks: Record<string, { name?: string; internal?: boolean; ipam?: unknown }>;
  volumes: Record<string, { name?: string } | null>;
}

const composeExists = existsSync(resolve(repoRoot(), 'docker-compose.yml'));
// Si el archivo no existe, el texto queda vacío y los tests fallan por aserción (no por una excepción de lectura).
const rawCompose = composeExists ? readRepoText('docker-compose.yml') : '';
const rawExample = readRepoText('.env.example');
const example = parseEnv(rawExample);

/** Variables obligatorias de la composición (referencias `:?`). */
const REQUIRED = {
  POSTGRES_USER: 'postgres',
  POSTGRES_PASSWORD: 'change-me',
  OWNER_PASSWORD: 'change-me',
  WRITER_PASSWORD: 'change-me',
  READER_PASSWORD: 'change-me',
  DB_NAME: 'todo_app',
  API_KEY: 'clave-de-prueba',
};

const EMPTY: Compose = { services: {}, networks: {}, volumes: {} };

function load(env: Record<string, string | undefined>): Compose {
  return (parse(interpolate(rawCompose, env)) as Compose | null) ?? EMPTY;
}

const withExample = load({ ...example, API_KEY: 'clave-de-prueba' });
const withMinimum = load(REQUIRED);
const services = withExample.services;

function service(compose: Compose, name: string): Service {
  return compose.services[name] ?? {};
}

function envOf(compose: Compose, name: string): Record<string, string> {
  return Object.fromEntries(Object.entries(service(compose, name).environment ?? {}).map(([k, v]) => [k, String(v)]));
}

function rawServices(): Record<string, Service> {
  return ((parse(rawCompose) as Compose | null) ?? EMPTY).services;
}

/** Servicios cuyo texto sin interpolar (YAML cargado tal cual) menciona la variable. */
function servicesReferencing(variable: string): string[] {
  return Object.entries(rawServices())
    .filter(([, definition]) => referencedVariables(JSON.stringify(definition)).includes(variable))
    .map(([name]) => name)
    .sort();
}

describe('RF-P16: interpolador de la composición', () => {
  it('RF-P16: ${X}, ${X:-v}, ${X:?msg} y $$ se interpolan', () => {
    const env = { A: 'uno', EMPTY: '' };
    expect(interpolate('${A}|${B}', env)).toBe('uno|');
    expect(interpolate('${A:-v}|${B:-v}|${EMPTY:-v}', env)).toBe('uno|v|v');
    expect(interpolate('${A:?falta}', env)).toBe('uno');
    expect(interpolate('$${A}', env)).toBe('${A}');
    expect(interpolate('${U:-http://x:3001}', env)).toBe('http://x:3001');
  });

  it('RF-P16: ${X:?msg} sin valor lanza un error que nombra X y no contiene valores', () => {
    expect(() => interpolate('${SECRETO:?defina SECRETO}', { OTRA: 'valor-secreto' })).toThrow(/SECRETO/);
    expect(() => interpolate('${SECRETO:?defina SECRETO}', { SECRETO: '' })).toThrow(/SECRETO/);
    try {
      interpolate('${SECRETO:?defina SECRETO}', { OTRA: 'valor-secreto' });
    } catch (error) {
      expect(String(error)).not.toContain('valor-secreto');
    }
  });

  it('RF-P16: una forma desconocida lanza', () => {
    expect(() => interpolate('${A-v}', {})).toThrow(/no admitida/);
    expect(() => interpolate('${A?m}', {})).toThrow(/no admitida/);
    expect(() => interpolate('$A', {})).toThrow(/no admitida/);
  });
});

describe('RF-P7: proyecto y servicios', () => {
  it('RF-P7: docker-compose.yml existe en la raíz', () => {
    expect(composeExists).toBe(true);
  });

  it('RF-P7: la composición define exactamente los servicios postgres, migrate, backend y frontend y fija name', () => {
    expect(Object.keys(services)).toEqual(['postgres', 'migrate', 'backend', 'frontend']);
    expect(withExample.name).toBe('todo-app-deploy');
  });

  it('RF-P7: el name, la red y el volumen son explícitos y distintos de los de docker-compose.dev.yml', () => {
    const dev = parse(readRepoText('docker-compose.dev.yml')) as Compose;
    expect(dev.name).toBeUndefined();
    expect(Object.keys(dev.volumes)).toEqual(['pgdata']);
    expect(withExample.volumes['todo_app_deploy_pgdata']?.name).toBe('todo_app_deploy_pgdata');
    expect(withExample.networks['internal']?.name).toBe('todo_app_deploy_internal');
    expect(withExample.networks['publish']?.name).toBe('todo_app_deploy_publish');
    expect(Object.keys(withExample.volumes)).not.toContain('pgdata');
  });
});

describe('RF-P3: imágenes', () => {
  it('RF-P3: la imagen de postgres lleva etiqueta completa 16.<parche> (nunca latest ni solo 16)', () => {
    expect(services['postgres']?.image).toMatch(/^postgres:16\.\d+(-[a-z0-9]+)?$/);
  });

  it('RF-P3: los build apuntan a ./backend y ./frontend con target migrate, runtime y runner', () => {
    expect(services['migrate']?.build).toEqual({ context: './backend', target: 'migrate' });
    expect(services['backend']?.build).toEqual({ context: './backend', target: 'runtime' });
    expect(services['frontend']?.build).toEqual({ context: './frontend', target: 'runner' });
  });
});

describe('RF-P8: migración con owner', () => {
  it('RF-P8: solo migrate recibe OWNER_DATABASE_URL (rol owner) y ni backend ni frontend referencian el owner', () => {
    expect(envOf(withExample, 'migrate')).toEqual({
      OWNER_DATABASE_URL: 'postgresql://owner:change-me@postgres:5432/todo_app',
    });
    for (const name of ['backend', 'frontend']) {
      const text = JSON.stringify(service(withExample, name).environment ?? {});
      expect(text).not.toContain('OWNER_PASSWORD');
      expect(text).not.toContain('OWNER_DATABASE_URL');
    }
  });
});

describe('RF-P9: orden de arranque', () => {
  it('RF-P9: depends_on es exactamente el mapa acordado y postgres no depende de nadie', () => {
    expect(services['migrate']?.depends_on).toEqual({ postgres: { condition: 'service_healthy' } });
    expect(services['backend']?.depends_on).toEqual({
      postgres: { condition: 'service_healthy' },
      migrate: { condition: 'service_completed_successfully' },
    });
    expect(services['frontend']?.depends_on).toEqual({
      backend: { condition: 'service_healthy' },
      postgres: { condition: 'service_healthy' },
    });
    expect(services['postgres']?.depends_on).toBeUndefined();
  });
});

describe('RF-P11 y RF-P12: puertos y redes', () => {
  it('RF-P11: postgres, migrate y backend no tienen ports; frontend tiene exactamente 127.0.0.1:3001:3001', () => {
    for (const name of ['postgres', 'migrate', 'backend']) {
      expect(service(withExample, name).ports, name).toBeUndefined();
    }
    expect(services['frontend']?.ports).toEqual(['127.0.0.1:3001:3001']);
  });

  it('RF-P12: internal es interna con los cuatro servicios; publish no lo es y solo frontend está en ella', () => {
    expect(withExample.networks['internal']?.internal).toBe(true);
    expect(withExample.networks['publish']?.internal).not.toBe(true);
    for (const name of ['postgres', 'migrate', 'backend', 'frontend']) {
      expect(service(withExample, name).networks, name).toContain('internal');
    }
    const inPublish = Object.entries(services)
      .filter(([, definition]) => definition.networks?.includes('publish'))
      .map(([name]) => name);
    expect(inPublish).toEqual(['frontend']);
  });

  it('RF-P12: no hay ipam, subnet, INTERNAL_SUBNET ni FRONTEND_IP en el archivo', () => {
    for (const forbidden of ['ipam', 'subnet', 'INTERNAL_SUBNET', 'FRONTEND_IP']) {
      expect(rawCompose.toLowerCase(), forbidden).not.toContain(forbidden.toLowerCase());
    }
  });

  it('RF-P12: el backend lleva TRUSTED_PROXIES igual al literal none, HOST 0.0.0.0 y PORT 3000', () => {
    const env = envOf(withExample, 'backend');
    expect(env['TRUSTED_PROXIES']).toBe('none');
    expect(env['HOST']).toBe('0.0.0.0');
    expect(env['PORT']).toBe('3000');
  });
});

describe('RF-P13: comprobaciones de salud', () => {
  it('RF-P13: postgres usa pg_isready -h 127.0.0.1', () => {
    const test = services['postgres']?.healthcheck?.test.join(' ') ?? '';
    expect(test).toContain('pg_isready -h 127.0.0.1');
  });

  it('RF-P13: backend y frontend usan node -e con node:http y GET, sin curl ni wget ni HEAD', () => {
    for (const name of ['backend', 'frontend']) {
      const test = service(withExample, name).healthcheck?.test ?? [];
      expect(test.slice(0, 3), name).toEqual(['CMD', 'node', '-e']);
      const script = test[3] ?? '';
      expect(script, name).toContain("require('node:http')");
      expect(script, name).toContain('http.get');
      expect(script, name).not.toMatch(/curl|wget/i);
      expect(script, name).not.toContain('HEAD');
      expect(script, name).not.toContain('$');
    }
    expect(service(withExample, 'backend').healthcheck?.test.join(' ')).toContain('http://127.0.0.1:3000/health');
    expect(service(withExample, 'frontend').healthcheck?.test.join(' ')).toContain('ALLOWED_HOSTS');
  });

  it('RF-P13: todos definen test, interval, timeout, retries y start_period', () => {
    const expected = {
      postgres: ['5s', '5s', 12, '10s'],
      backend: ['10s', '5s', 5, '10s'],
      frontend: ['10s', '5s', 5, '20s'],
    };
    for (const [name, [interval, timeout, retries, startPeriod]] of Object.entries(expected)) {
      const check = service(withExample, name).healthcheck;
      expect(check?.test.length, name).toBeGreaterThan(1);
      expect([check?.interval, check?.timeout, check?.retries, check?.start_period], name).toEqual([
        interval,
        timeout,
        retries,
        startPeriod,
      ]);
    }
  });
});

describe('RF-P14 y RF-P15: variables por servicio', () => {
  it('RF-P14: TRUSTED_PROXIES no es sobrescribible (no hay ${...} en su valor)', () => {
    expect(rawServices()['backend']?.environment?.['TRUSTED_PROXIES']).toBe('none');
  });

  it('RF-P15: ningún servicio usa env_file', () => {
    for (const [name, definition] of Object.entries(services)) {
      expect(definition.env_file, name).toBeUndefined();
    }
    expect(rawCompose).not.toContain('env_file');
  });

  it('RF-P15: el backend recibe exactamente 11 variables y ninguna de las 4 del esquema por defecto', () => {
    const names = Object.keys(envOf(withExample, 'backend')).sort();
    expect(names).toEqual(
      [
        'DATABASE_URL',
        'API_KEY',
        'CORS_ORIGIN',
        'HOST',
        'PORT',
        'TRUSTED_PROXIES',
        'SHUTDOWN_TIMEOUT_MS',
        'RATE_LIMIT_WINDOW_MS',
        'RATE_LIMIT_MAX',
        'RATE_LIMIT_POST_MAX',
        'RATE_LIMIT_AUTH_FAILURES_MAX',
      ].sort(),
    );
    const defaults = ['TASKS_LIST_LIMIT', 'DB_POOL_MAX', 'DB_POOL_IDLE_TIMEOUT_MS', 'DB_POOL_CONNECTION_TIMEOUT_MS'];
    for (const absent of defaults) {
      expect(names).not.toContain(absent);
    }
  });

  it('RF-P15: frontend, migrate y postgres reciben exactamente sus variables, sin DB_NAME_TEST', () => {
    expect(Object.keys(envOf(withExample, 'frontend')).sort()).toEqual(
      ['BACKEND_URL', 'API_KEY', 'READER_DATABASE_URL', 'ALLOWED_HOSTS', 'PORT', 'HOSTNAME'].sort(),
    );
    expect(Object.keys(envOf(withExample, 'migrate'))).toEqual(['OWNER_DATABASE_URL']);
    expect(Object.keys(envOf(withExample, 'postgres')).sort()).toEqual(
      ['POSTGRES_USER', 'POSTGRES_PASSWORD', 'OWNER_PASSWORD', 'WRITER_PASSWORD', 'READER_PASSWORD', 'DB_NAME'].sort(),
    );
    expect(rawCompose).not.toContain('DB_NAME_TEST');
  });

  it('RF-P15: cada contraseña de rol solo aparece en los servicios que la necesitan', () => {
    expect(servicesReferencing('WRITER_PASSWORD')).toEqual(['backend', 'postgres']);
    expect(servicesReferencing('READER_PASSWORD')).toEqual(['frontend', 'postgres']);
    expect(servicesReferencing('OWNER_PASSWORD')).toEqual(['migrate', 'postgres']);
  });

  it('RF-P15: con las variables de .env.example, las URL usan postgres:5432 y BACKEND_URL es http://backend:3000', () => {
    expect(envOf(withExample, 'backend')['DATABASE_URL']).toBe('postgresql://writer:change-me@postgres:5432/todo_app');
    expect(envOf(withExample, 'migrate')['OWNER_DATABASE_URL']).toBe(
      'postgresql://owner:change-me@postgres:5432/todo_app',
    );
    const frontend = envOf(withExample, 'frontend');
    expect(frontend['READER_DATABASE_URL']).toBe('postgresql://reader:change-me@postgres:5432/todo_app');
    expect(frontend['BACKEND_URL']).toBe('http://backend:3000');
    for (const value of [
      envOf(withExample, 'backend')['DATABASE_URL'],
      envOf(withExample, 'migrate')['OWNER_DATABASE_URL'],
      frontend['READER_DATABASE_URL'],
    ]) {
      expect(value).not.toContain('127.0.0.1');
      expect(value).not.toContain('5433');
    }
  });

  it('RF-P15: con entorno mínimo, los cupos, CORS_ORIGIN y ALLOWED_HOSTS toman sus valores por defecto', () => {
    const backend = envOf(withMinimum, 'backend');
    expect(backend['RATE_LIMIT_WINDOW_MS']).toBe('900000');
    expect(backend['RATE_LIMIT_MAX']).toBe('1000');
    expect(backend['RATE_LIMIT_POST_MAX']).toBe('200');
    expect(backend['RATE_LIMIT_AUTH_FAILURES_MAX']).toBe('10');
    expect(backend['CORS_ORIGIN']).toBe('http://localhost:3001');
    expect(backend['SHUTDOWN_TIMEOUT_MS']).toBe('10000');
    expect(envOf(withMinimum, 'frontend')['ALLOWED_HOSTS']).toBe('localhost:3001,127.0.0.1:3001');
    expect(rawServices()['backend']?.environment?.['SHUTDOWN_TIMEOUT_MS']).toBe('10000');
  });
});

describe('RF-P16 y RNF-P1: variables y secretos', () => {
  it('RF-P16: con un entorno vacío, interpolar falla nombrando la primera variable obligatoria sin valores', () => {
    expect(() => interpolate(rawCompose, {})).toThrow(/POSTGRES_USER/);
    expect(() => interpolate(rawCompose, { POSTGRES_USER: 'x'.repeat(5) })).toThrow(/POSTGRES_PASSWORD/);
  });

  it('RF-P16: toda variable referenciada en la composición figura en .env.example (activa o comentada)', () => {
    const names = referencedVariables(rawCompose);
    expect(names.length).toBeGreaterThan(10);
    for (const name of names) {
      expect(rawExample, name).toMatch(new RegExp(`^#?\\s*${name}=`, 'm'));
    }
  });

  it('RNF-P1: ni la composición ni los Dockerfile contienen change-me ni una contraseña literal en una URL', () => {
    const files = ['docker-compose.yml', 'backend/Dockerfile', 'frontend/Dockerfile'];
    for (const file of files) {
      const text = readRepoText(file);
      expect(text, file).not.toContain('change-me');
      expect(text, file).not.toMatch(/:\/\/[^:@/\s]+:(?!\$\{)[^@\s]+@/);
    }
  });
});
