import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { readRepoText, repoRoot } from '../helpers/repo-files';

// Pruebas estáticas del endurecimiento, los límites, el reinicio y los plazos de cierre de docker-compose.yml.
// Leen el archivo sin interpolar (las variables se comprueban como texto) y no usan Docker.

interface Service {
  security_opt?: string[];
  cap_drop?: string[];
  cap_add?: string[];
  read_only?: boolean;
  tmpfs?: string[];
  restart?: string;
  mem_limit?: string;
  cpus?: string;
  pids_limit?: string;
  stop_grace_period?: string;
  stop_signal?: string;
  volumes?: string[];
  environment?: Record<string, string>;
}
interface Compose {
  services: Record<string, Service>;
}

const composeExists = existsSync(resolve(repoRoot(), 'docker-compose.yml'));
// Sin archivo, el texto queda vacío y los tests fallan por aserción (no por una excepción de lectura).
const raw = composeExists ? readRepoText('docker-compose.yml') : '';
const services = ((parse(raw) as Compose | null) ?? { services: {} }).services;
const exampleText = readRepoText('.env.example');

function service(name: string): Service {
  return services[name] ?? {};
}

const HARDENED = ['backend', 'frontend'];

describe('RF-P17: endurecimiento de backend y frontend', () => {
  it.each(HARDENED)('RF-P17: %s tiene no-new-privileges, cap_drop ALL y ningún cap_add', (name) => {
    expect(service(name).security_opt).toEqual(['no-new-privileges:true']);
    expect(service(name).cap_drop).toEqual(['ALL']);
    expect(service(name).cap_add).toBeUndefined();
  });

  it.each(HARDENED)('RF-P17: %s tiene read_only true', (name) => {
    expect(service(name).read_only).toBe(true);
  });

  it('RF-P17: el backend tiene un tmpfs en /tmp y nada más', () => {
    expect(service('backend').tmpfs).toEqual(['/tmp']);
  });

  it('RF-P17: el frontend tiene un tmpfs en /tmp y otro en /app/.next/cache escribible por el UID 10001', () => {
    expect(service('frontend').tmpfs).toEqual(['/tmp', '/app/.next/cache:uid=10001,gid=10001,mode=0755']);
  });

  it('RF-P17: postgres, backend y frontend se reinician salvo parada manual; migrate no', () => {
    for (const name of ['postgres', 'backend', 'frontend']) {
      expect(service(name).restart).toBe('unless-stopped');
    }
    expect(service('migrate').restart).toBe('no');
  });

  it.each([
    ['backend', 'BACKEND', '512m', '1.0', '200'],
    ['frontend', 'FRONTEND', '768m', '1.0', '300'],
  ])('RF-P17: los límites de %s usan variables con valores por defecto', (name, prefix, mem, cpus, pids) => {
    expect(service(name).mem_limit).toBe(`\${${prefix}_MEM_LIMIT:-${mem}}`);
    expect(service(name).cpus).toBe(`\${${prefix}_CPUS:-${cpus}}`);
    expect(service(name).pids_limit).toBe(`\${${prefix}_PIDS_LIMIT:-${pids}}`);
    for (const suffix of ['MEM_LIMIT', 'CPUS', 'PIDS_LIMIT']) {
      expect(exampleText).toContain(`${prefix}_${suffix}`);
    }
  });

  it('RF-P17: postgres y migrate no tienen cap_drop ni read_only; postgres conserva no-new-privileges', () => {
    for (const name of ['postgres', 'migrate']) {
      expect(service(name).cap_drop).toBeUndefined();
      expect(service(name).read_only).toBeUndefined();
    }
    expect(service('postgres').security_opt).toEqual(['no-new-privileges:true']);
    expect(service('migrate').security_opt).toBeUndefined();
  });
});

describe('RF-P18: datos en un volumen propio', () => {
  it('RF-P18: postgres monta el volumen todo_app_deploy_pgdata y el script de inicio en solo lectura', () => {
    const volumes = service('postgres').volumes ?? [];
    expect(volumes).toContain('todo_app_deploy_pgdata:/var/lib/postgresql/data');
    expect(volumes).toContain('./docker/postgres/init:/docker-entrypoint-initdb.d:ro');
  });
});

describe('RF-P19: plazos de cierre', () => {
  const seconds = (value: string | undefined): number => {
    const match = /^(\d+)s$/.exec(value ?? '');
    return match ? Number(match[1]) : Number.NaN;
  };

  it('RF-P19: stop_grace_period es 20s en backend, 15s en frontend y 30s en postgres', () => {
    expect(service('backend').stop_grace_period).toBe('20s');
    expect(service('frontend').stop_grace_period).toBe('15s');
    expect(service('postgres').stop_grace_period).toBe('30s');
  });

  it('RF-P19: el plazo del backend supera a SHUTDOWN_TIMEOUT_MS en al menos 5000 ms', () => {
    const timeout = Number(service('backend').environment?.SHUTDOWN_TIMEOUT_MS);
    expect(timeout).toBe(10000);
    expect(seconds(service('backend').stop_grace_period) * 1000).toBeGreaterThanOrEqual(timeout + 5000);
  });

  it('RF-P19: SHUTDOWN_TIMEOUT_MS es el literal 10000 y ningún servicio redefine stop_signal', () => {
    expect(raw).toMatch(/SHUTDOWN_TIMEOUT_MS: "10000"/);
    expect(raw).not.toContain('SHUTDOWN_TIMEOUT_MS: ${');
    for (const name of Object.keys(services)) {
      expect(service(name).stop_signal).toBeUndefined();
    }
  });
});
