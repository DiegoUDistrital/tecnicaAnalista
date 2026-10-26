import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { attachPrefixed } from '../scripts/lib/prefixed-output.js';

function setup() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  /** @type {string[]} */
  const lines = [];
  attachPrefixed({ name: 'backend', stdout, stderr }, (text) => lines.push(text));
  return { stdout, stderr, lines };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

describe('attachPrefixed', () => {
  it('RF-I5: cada línea sale con su prefijo aunque un trozo traiga media línea', async () => {
    const { stdout, lines } = setup();
    stdout.write('uno\ndos y me');
    stdout.write('dia\r\ntres\n');
    await tick();
    expect(lines).toEqual(['[backend] uno\n', '[backend] dos y media\n', '[backend] tres\n']);
  });

  it('RF-I5: la última línea sin salto de línea se escribe al cerrar', async () => {
    const { stdout, lines } = setup();
    stdout.write('final sin salto');
    await tick();
    expect(lines).toEqual([]);
    stdout.end();
    await tick();
    expect(lines).toEqual(['[backend] final sin salto\n']);
  });

  it('RF-I5: un cierre sin texto pendiente no escribe una línea vacía', async () => {
    const { stdout, lines } = setup();
    stdout.write('completa\n');
    stdout.end();
    await tick();
    expect(lines).toEqual(['[backend] completa\n']);
  });

  it('RF-I5: stdout y stderr comparten prefijo', async () => {
    const { stdout, stderr, lines } = setup();
    stdout.write('salida\n');
    await tick();
    stderr.write('error\n');
    await tick();
    expect(lines).toEqual(['[backend] salida\n', '[backend] error\n']);
  });
});
