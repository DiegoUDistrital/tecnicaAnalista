import { describe, expect, it } from 'vitest';
import { clientKey, connectionAddress, type ClientRequest } from '../../src/security/client-key';
import { testProxies } from '../helpers/security';

const LOOPBACK = testProxies('loopback');
const NONE = testProxies('none');

/** Petición mínima: dirección de la conexión y cabeceras (el valor de X-Forwarded-For tal como lo une Node). */
function request(
  remoteAddress: string | undefined,
  headers: Record<string, string | string[] | undefined> = {},
): ClientRequest {
  return { socket: { remoteAddress }, headers };
}

function withForwarded(remoteAddress: string, forwarded: string | string[]): ClientRequest {
  return request(remoteAddress, { 'x-forwarded-for': forwarded });
}

describe('RF-G11: dirección de la conexión', () => {
  it('RF-G11: connectionAddress quita la zona, abrevia y convierte la IPv4-mapeada', () => {
    expect(connectionAddress({ remoteAddress: '127.0.0.1' })).toBe('127.0.0.1');
    expect(connectionAddress({ remoteAddress: '::ffff:127.0.0.1' })).toBe('127.0.0.1');
    expect(connectionAddress({ remoteAddress: '::1' })).toBe('::1');
    expect(connectionAddress({ remoteAddress: 'fe80:0:0:0:0:0:0:1%eth0' })).toBe('fe80::1');
  });

  it('RF-G11: connectionAddress devuelve undefined sin dirección o con una que no se puede normalizar', () => {
    expect(connectionAddress({ remoteAddress: undefined })).toBeUndefined();
    expect(connectionAddress({ remoteAddress: '' })).toBeUndefined();
    expect(connectionAddress({ remoteAddress: 'garbage' })).toBeUndefined();
  });
});

describe('RF-G11: clave de cupo según la IP del cliente', () => {
  it('RF-G11 (a): conexión de confianza y X-Forwarded-For: A cuenta A', () => {
    expect(clientKey(withForwarded('127.0.0.1', '203.0.113.7'), LOOPBACK)).toBe('203.0.113.7');
  });

  it('RF-G11 (a): se reconocen las tres formas de loopback de la conexión', () => {
    for (const remote of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      expect(clientKey(withForwarded(remote, '203.0.113.7'), LOOPBACK), remote).toBe('203.0.113.7');
    }
  });

  it('RF-G11 (b): X-Forwarded-For: X, A cuenta A y cambiar X no cambia la clave', () => {
    const keys = ['1.1.1.1', '2.2.2.2', 'not-an-ip', '::1', ''].map((x) =>
      clientKey(withForwarded('127.0.0.1', `${x}, 203.0.113.7`), LOOPBACK),
    );
    expect(new Set(keys)).toEqual(new Set(['203.0.113.7']));
  });

  it('RF-G11 (b): la cabecera repetida (unida con coma y espacio por Node o como arreglo) cuenta la última', () => {
    expect(clientKey(withForwarded('127.0.0.1', '1.1.1.1, 203.0.113.7'), LOOPBACK)).toBe('203.0.113.7');
    expect(clientKey(withForwarded('127.0.0.1', ['1.1.1.1', '203.0.113.7']), LOOPBACK)).toBe('203.0.113.7');
  });

  it('RF-G11 (b): se saltan las entradas de confianza de la derecha y decide la primera que no lo es', () => {
    expect(clientKey(withForwarded('127.0.0.1', '9.9.9.9, 203.0.113.7, 127.0.0.1, ::1'), LOOPBACK)).toBe('203.0.113.7');
  });

  it('RF-G11 (b2): junk, A cuenta A', () => {
    expect(clientKey(withForwarded('127.0.0.1', 'junk, 203.0.113.7'), LOOPBACK)).toBe('203.0.113.7');
  });

  it('RF-G11 (b2): A, junk cuenta la dirección de la conexión', () => {
    expect(clientKey(withForwarded('127.0.0.1', '203.0.113.7, junk'), LOOPBACK)).toBe('127.0.0.1');
  });

  it('RF-G11 (b2): si todas las entradas son de confianza (127.0.0.1, 127.0.0.1) cuenta la conexión', () => {
    expect(clientKey(withForwarded('127.0.0.1', '127.0.0.1, 127.0.0.1'), LOOPBACK)).toBe('127.0.0.1');
    expect(clientKey(withForwarded('::1', '127.0.0.1'), LOOPBACK)).toBe('v6/64:0:0:0:0');
  });

  it('RF-G11 (c): conexión que no es de confianza ignora X-Forwarded-For', () => {
    expect(clientKey(withForwarded('198.51.100.9', '203.0.113.7'), LOOPBACK)).toBe('198.51.100.9');
    expect(clientKey(withForwarded('198.51.100.9', '203.0.113.7, 127.0.0.1'), LOOPBACK)).toBe('198.51.100.9');
  });

  it.each([
    ['not-an-ip', 'not-an-ip'],
    ['vacío', ''],
    ['con puerto', '203.0.113.7:8080'],
    ['con corchetes', '[2001:db8::1]'],
    ['con zona', 'fe80::1%eth0'],
    ['con ceros a la izquierda', '203.000.113.007'],
    ['de más de 512 caracteres', `${' '.repeat(502)}203.0.113.7`],
  ])('RF-G11 (d): valor %s cuenta la conexión', (_label, value) => {
    expect(clientKey(withForwarded('127.0.0.1', value), LOOPBACK)).toBe('127.0.0.1');
  });

  it('RF-G11 (d) y P4: 512 caracteres todavía se leen y 513 son basura', () => {
    expect(clientKey(withForwarded('127.0.0.1', `${' '.repeat(501)}203.0.113.7`), LOOPBACK)).toBe('203.0.113.7');
    expect(clientKey(withForwarded('127.0.0.1', `${' '.repeat(502)}203.0.113.7`), LOOPBACK)).toBe('127.0.0.1');
  });

  it('RF-G11 (d): los valores malformados distintos no crean claves nuevas', () => {
    const keys = ['x', 'y', '1.2.3.4:1', '[::1]', '', 'fe80::1%a', '010.0.0.1'].map((value) =>
      clientKey(withForwarded('127.0.0.1', value), LOOPBACK),
    );
    expect(new Set(keys)).toEqual(new Set(['127.0.0.1']));
  });

  it('RF-G11 (e): el mismo /64 comparte clave y otro /64 no, venga de la conexión o de la cabecera', () => {
    const a = clientKey(request('2001:db8:1:2::1'), LOOPBACK);
    const sameNetwork = clientKey(request('2001:db8:1:2:ffff:ffff:ffff:ffff'), LOOPBACK);
    const otherNetwork = clientKey(request('2001:db8:1:3::1'), LOOPBACK);
    expect(sameNetwork).toBe(a);
    expect(otherNetwork).not.toBe(a);

    const viaHeader = (value: string) => clientKey(withForwarded('127.0.0.1', value), LOOPBACK);
    expect(viaHeader('2001:db8:1:2::1')).toBe(a);
    expect(viaHeader('2001:db8:1:2:aaaa::5')).toBe(a);
    expect(viaHeader('2001:db8:1:3::1')).toBe(otherNetwork);
  });

  it('RF-G11 (e): la forma larga y la abreviada de una IPv6 son la misma clave', () => {
    expect(clientKey(request('2001:0db8:0000:0000:0000:0000:0000:0001'), LOOPBACK)).toBe(
      clientKey(request('2001:db8::1'), LOOPBACK),
    );
  });

  it('RF-G11 (e): una IPv4-mapeada cuenta igual que la IPv4', () => {
    expect(clientKey(request('::ffff:203.0.113.7'), LOOPBACK)).toBe('203.0.113.7');
    expect(clientKey(withForwarded('127.0.0.1', '::ffff:203.0.113.7'), LOOPBACK)).toBe('203.0.113.7');
    expect(clientKey(withForwarded('127.0.0.1', '::ffff:cb00:7107'), LOOPBACK)).toBe('203.0.113.7');
  });

  it('RF-G11: la zona de la conexión se quita antes de calcular la clave', () => {
    expect(clientKey(request('fe80::1%eth0'), LOOPBACK)).toBe('v6/64:fe80:0:0:0');
    expect(clientKey(withForwarded('fe80::1%eth0', '203.0.113.7'), testProxies('linklocal'))).toBe('203.0.113.7');
  });

  it('RF-G11 (f): sin X-Forwarded-For cuenta la conexión (cupo compartido del frontend)', () => {
    expect(clientKey(request('127.0.0.1'), LOOPBACK)).toBe('127.0.0.1');
    expect(clientKey(request('::1'), LOOPBACK)).toBe('v6/64:0:0:0:0');
  });

  it('RF-G11: Forwarded y X-Real-IP no influyen', () => {
    const headers = { forwarded: 'for=203.0.113.7', 'x-real-ip': '203.0.113.8' };
    expect(clientKey(request('127.0.0.1', headers), LOOPBACK)).toBe('127.0.0.1');
    expect(clientKey(request('198.51.100.9', headers), LOOPBACK)).toBe('198.51.100.9');
  });

  it('RF-G12: con TRUSTED_PROXIES=none ninguna cabecera influye', () => {
    expect(clientKey(withForwarded('127.0.0.1', '203.0.113.7'), NONE)).toBe('127.0.0.1');
    expect(clientKey(withForwarded('::1', '203.0.113.7'), NONE)).toBe('v6/64:0:0:0:0');
  });

  it('RF-G11: un socket sin dirección (o con una que no se puede normalizar) usa la clave unknown', () => {
    expect(clientKey(request(undefined), LOOPBACK)).toBe('unknown');
    expect(clientKey(withForwarded('garbage', '203.0.113.7'), LOOPBACK)).toBe('unknown');
    expect(clientKey(request(undefined, { 'x-forwarded-for': '203.0.113.7' }), NONE)).toBe('unknown');
  });
});
