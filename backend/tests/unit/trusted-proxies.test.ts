import { describe, expect, it } from 'vitest';
import { parseTrustedProxies, type TrustedProxies } from '../../src/security/trusted-proxies';

function valid(raw: string | undefined): TrustedProxies {
  const parsed = parseTrustedProxies(raw);
  if (parsed === undefined) {
    throw new Error(`Se esperaba una lista válida: ${JSON.stringify(raw)}`);
  }
  return parsed;
}

describe('RF-G12: TRUSTED_PROXIES inválida', () => {
  it.each([
    '',
    ' ',
    ',',
    'None',
    'NONE',
    'none,loopback',
    'loopback,none',
    'loopback,,10.0.0.1',
    'a,',
    ',a',
    'loopback,',
    ',loopback',
    'true',
    'false',
    '1',
    'Loopback',
    'LOOPBACK',
    'LinkLocal',
    'uniquelocal2',
    '0.0.0.0/0',
    '::/0',
    '10.0.0.0/7',
    'fc00::/6',
    '10.0.0.0/33',
    'fc00::/129',
    '/33',
    '/8',
    '10.0.0.0/',
    '10.0.0.0/08',
    '10.0.0.0/-8',
    '10.0.0.0/8/8',
    '10.0.0.0/+8',
    '10.0.0.0/255.0.0.0',
    'fe80::1%eth0',
    'fe80::/10%eth0',
    '010.0.0.1',
    '010.0.0.0/8',
    '10.0.0.1 10.0.0.2',
    '10.0.0. 1',
    '[::1]',
    '10.0.0.1:80',
    'loopback/8',
    'example.com',
    '::ffff:10.0.0.0/104',
    '::ffff:a00:0/104',
  ])('RF-G12: %j es inválida', (raw) => {
    expect(parseTrustedProxies(raw)).toBeUndefined();
  });
});

describe('RF-G12: TRUSTED_PROXIES válida', () => {
  it('RF-G12: ausente equivale a loopback', () => {
    const proxies = valid(undefined);
    expect(proxies.contains('127.0.0.1')).toBe(true);
    expect(proxies.contains('::1')).toBe(true);
    expect(proxies.contains('10.0.0.1')).toBe(false);
  });

  it('RF-G12: none (en minúsculas y solo) es una lista vacía: nadie es de confianza', () => {
    const proxies = valid('none');
    expect(proxies.contains('127.0.0.1')).toBe(false);
    expect(proxies.contains('::1')).toBe(false);
    expect(proxies.contains('10.0.0.1')).toBe(false);
  });

  it('RF-G12: loopback, 10.0.0.0/8 es válida (los espacios alrededor de cada entrada se recortan)', () => {
    const proxies = valid('loopback, 10.0.0.0/8');
    expect(proxies.contains('127.0.0.1')).toBe(true);
    expect(proxies.contains('10.9.9.9')).toBe(true);
    expect(proxies.contains('11.0.0.1')).toBe(false);
    expect(valid('  loopback  ').contains('127.0.0.1')).toBe(true);
  });

  it('RF-G12: las entradas duplicadas se aceptan sin efecto', () => {
    const proxies = valid('loopback,loopback,10.0.0.1,10.0.0.1');
    expect(proxies.contains('127.0.0.1')).toBe(true);
    expect(proxies.contains('10.0.0.1')).toBe(true);
    expect(proxies.contains('10.0.0.2')).toBe(false);
  });

  it('RF-G12: una dirección suelta cubre solo esa dirección (IPv4 e IPv6, mayúsculas normalizadas)', () => {
    const proxies = valid('203.0.113.7,FD00::0001');
    expect(proxies.contains('203.0.113.7')).toBe(true);
    expect(proxies.contains('203.0.113.8')).toBe(false);
    expect(proxies.contains('fd00::1')).toBe(true);
    expect(proxies.contains('fd00::2')).toBe(false);
  });

  it('RF-G12: una IPv4-mapeada sin prefijo se convierte a IPv4', () => {
    const proxies = valid('::ffff:10.0.0.5');
    expect(proxies.contains('10.0.0.5')).toBe(true);
    expect(proxies.contains('10.0.0.6')).toBe(false);
  });

  it('RF-G12: los prefijos mínimos (IPv4 /8, IPv6 /7) y máximos se aceptan y delimitan el rango', () => {
    expect(valid('10.0.0.0/8').contains('10.255.255.255')).toBe(true);
    expect(valid('10.0.0.0/8').contains('11.0.0.0')).toBe(false);
    expect(valid('10.1.2.3/32').contains('10.1.2.3')).toBe(true);
    expect(valid('10.1.2.3/32').contains('10.1.2.4')).toBe(false);
    expect(valid('fc00::/7').contains('fd12::1')).toBe(true);
    expect(valid('fc00::/7').contains('fe00::1')).toBe(false);
    expect(valid('::1/128').contains('::1')).toBe(true);
    expect(valid('::1/128').contains('::2')).toBe(false);
  });

  it('RF-G12: los nombres son sensibles a mayúsculas y cada uno cubre exactamente sus rangos (P3)', () => {
    const loopback = valid('loopback');
    for (const ip of ['127.0.0.1', '127.255.255.255', '::1']) {
      expect(loopback.contains(ip), ip).toBe(true);
    }
    for (const ip of ['128.0.0.1', '126.255.255.255', '::2', 'fe80::1', '10.0.0.1']) {
      expect(loopback.contains(ip), ip).toBe(false);
    }

    const linklocal = valid('linklocal');
    for (const ip of ['169.254.0.1', '169.254.255.255', 'fe80::1', 'febf::1']) {
      expect(linklocal.contains(ip), ip).toBe(true);
    }
    for (const ip of ['169.255.0.1', '169.253.255.255', 'fec0::1', '127.0.0.1']) {
      expect(linklocal.contains(ip), ip).toBe(false);
    }

    const uniquelocal = valid('uniquelocal');
    for (const ip of ['10.1.1.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', 'fc00::1', 'fdff::1']) {
      expect(uniquelocal.contains(ip), ip).toBe(true);
    }
    for (const ip of ['11.0.0.1', '172.15.255.255', '172.32.0.1', '192.169.0.1', 'fe00::1', '8.8.8.8', '127.0.0.1']) {
      expect(uniquelocal.contains(ip), ip).toBe(false);
    }
  });
});
