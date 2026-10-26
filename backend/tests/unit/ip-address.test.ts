import { describe, expect, it } from 'vitest';
import { canonicalIp, ipv6Prefix64, stripZone } from '../../src/security/ip-address';

describe('RF-G11: dirección canónica', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['0.0.0.0', '0.0.0.0'],
    ['255.255.255.255', '255.255.255.255'],
    ['::1', '::1'],
    ['::', '::'],
    ['fe80::1', 'fe80::1'],
    ['2001:0DB8:0000:0000:0000:0000:0000:0001', '2001:db8::1'],
    ['2001:db8::1', '2001:db8::1'],
    ['1:0:0:2:0:0:0:3', '1:0:0:2::3'],
    ['1:0:0:2:0:0:3:4', '1::2:0:0:3:4'],
    ['1:0:2:3:4:5:6:7', '1:0:2:3:4:5:6:7'],
    ['0:0:0:0:0:0:0:1', '::1'],
    ['2001:db8::192.0.2.1', '2001:db8::c000:201'],
  ])('RF-G11: canonicalIp acepta %j y devuelve %j', (text, expected) => {
    expect(canonicalIp(text)).toBe(expected);
  });

  it.each([
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:203.0.113.7', '203.0.113.7'],
    ['::ffff:cb00:7107', '203.0.113.7'],
    ['0:0:0:0:0:ffff:cb00:7107', '203.0.113.7'],
    ['::ffff:127.0.0.1', '127.0.0.1'],
  ])('RF-G11: canonicalIp convierte la IPv4-mapeada %j a la IPv4 %j', (text, expected) => {
    expect(canonicalIp(text)).toBe(expected);
  });

  it('RF-G11: la forma larga y la abreviada de una IPv6 son la misma dirección canónica', () => {
    expect(canonicalIp('2001:0db8:0000:0000:0000:0000:0000:0001')).toBe(canonicalIp('2001:db8::1'));
  });

  it.each([
    ['con zona', 'fe80::1%eth0'],
    ['con ceros a la izquierda', '010.0.0.1'],
    ['con ceros a la izquierda al final', '1.2.3.04'],
    ['con ceros a la izquierda en una mapeada', '::ffff:010.0.0.1'],
    ['con puerto', '1.2.3.4:80'],
    ['con corchetes', '[::1]'],
    ['con corchetes y puerto', '[::1]:80'],
    ['vacío', ''],
    ['solo espacios', '  '],
    ['con espacios alrededor', ' 1.2.3.4 '],
    ['octeto fuera de rango', '256.0.0.1'],
    ['tres octetos', '1.2.3'],
    ['cinco octetos', '1.2.3.4.5'],
    ['texto', 'not-an-ip'],
    ['IPv6 con dos abreviaturas', '1::2::3'],
    ['texto largo', 'a'.repeat(600)],
  ])('RF-G11: canonicalIp rechaza una dirección %s', (_label, text) => {
    expect(canonicalIp(text)).toBeUndefined();
  });

  it('RF-G11: stripZone quita la zona de la dirección de la conexión', () => {
    expect(stripZone('fe80::1%eth0')).toBe('fe80::1');
    expect(stripZone('fe80::1%')).toBe('fe80::1');
    expect(stripZone('1.2.3.4')).toBe('1.2.3.4');
  });

  it('RF-G11 (e): ipv6Prefix64 devuelve los cuatro primeros grupos de la dirección canónica', () => {
    expect(ipv6Prefix64('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2');
    expect(ipv6Prefix64('2001:db8::1')).toBe('2001:db8:0:0');
    expect(ipv6Prefix64('::1')).toBe('0:0:0:0');
    expect(ipv6Prefix64('1::')).toBe('1:0:0:0');
    expect(ipv6Prefix64('::')).toBe('0:0:0:0');
  });
});
