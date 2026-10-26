import { BlockList, isIP } from 'node:net';
import { describe, expect, it } from 'vitest';

// Caracterización de lo que Node hace de verdad (nacen en verde): fijan las suposiciones de las que depende la
// IP real del cliente (RF-G11) y TRUSTED_PROXIES (RF-G12).

describe('RF-G11: net.isIP (A VERIFICAR de la tarea 1)', () => {
  it('RF-G11: isIP acepta la zona (por eso se normaliza aparte) y rechaza puerto, corchetes y ceros', () => {
    expect(isIP('fe80::1%eth0')).toBe(6);
    expect(isIP('1.2.3.4:80')).toBe(0);
    expect(isIP('[::1]')).toBe(0);
    expect(isIP('010.0.0.1')).toBe(0);
    expect(isIP('::ffff:127.0.0.1')).toBe(6);
  });
});

describe('RF-G12: net.BlockList (A VERIFICAR de la tarea 1)', () => {
  it('RF-G12: addAddress, addSubnet y check con IPv4 e IPv6 y los prefijos 10.0.0.0/8 y fc00::/7', () => {
    const list = new BlockList();
    list.addAddress('::1', 'ipv6');
    list.addAddress('203.0.113.7', 'ipv4');
    list.addSubnet('10.0.0.0', 8, 'ipv4');
    list.addSubnet('fc00::', 7, 'ipv6');

    expect(list.check('::1', 'ipv6')).toBe(true);
    expect(list.check('::2', 'ipv6')).toBe(false);
    expect(list.check('203.0.113.7', 'ipv4')).toBe(true);
    expect(list.check('203.0.113.8', 'ipv4')).toBe(false);
    expect(list.check('10.255.255.255', 'ipv4')).toBe(true);
    expect(list.check('11.0.0.0', 'ipv4')).toBe(false);
    expect(list.check('fd12:3456::1', 'ipv6')).toBe(true);
    expect(list.check('fe00::1', 'ipv6')).toBe(false);
  });
});
