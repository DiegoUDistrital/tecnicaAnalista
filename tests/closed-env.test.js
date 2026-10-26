import { describe, expect, it } from 'vitest';
import { buildClosedEnv } from '../scripts/lib/closed-env.js';

describe('buildClosedEnv', () => {
  // eslint-disable-next-line max-len -- el nombre del test cita la tarea literalmente
  it('RF-I8: el entorno de un hijo solo trae PATH aunque el padre tenga API_KEY, DATABASE_URL, NODE_OPTIONS y otras', () => {
    const parent = {
      PATH: '/usr/bin',
      API_KEY: 'sentinel-key',
      DATABASE_URL: 'postgres://sentinel',
      NODE_OPTIONS: '--require sentinel',
      HOME: '/home/sentinel',
    };
    expect(buildClosedEnv('linux', parent, {})).toEqual({ PATH: '/usr/bin' });
  });

  it('RF-I8: en win32 se añaden SystemRoot, TEMP y TMP y nada más', () => {
    const parent = {
      PATH: 'C:\\bin',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\tmp',
      TMP: 'C:\\tmp2',
      USERPROFILE: 'C:\\Users\\sentinel',
      API_KEY: 'sentinel-key',
    };
    expect(buildClosedEnv('win32', parent, {})).toEqual({
      PATH: 'C:\\bin',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\tmp',
      TMP: 'C:\\tmp2',
    });
  });

  it("RF-I8: en Windows la clave 'Path' del padre se entrega como PATH", () => {
    const result = buildClosedEnv('win32', { Path: 'C:\\bin', SYSTEMROOT: 'C:\\Windows' }, {});
    expect(result).toEqual({ PATH: 'C:\\bin', SystemRoot: 'C:\\Windows' });
    expect(Object.keys(result)).not.toContain('Path');
  });

  it('RF-I8: lo que pasa el comando en extra (por ejemplo PORT y HOST) se añade y pisa', () => {
    const result = buildClosedEnv('linux', { PATH: '/usr/bin' }, { PORT: '3000', HOST: '127.0.0.1', PATH: '/custom' });
    expect(result).toEqual({ PATH: '/custom', PORT: '3000', HOST: '127.0.0.1' });
  });

  it('RF-I8: si el padre no tiene SystemRoot no se inventa', () => {
    const result = buildClosedEnv('win32', { PATH: 'C:\\bin' }, {});
    expect(result).toEqual({ PATH: 'C:\\bin' });
    expect(buildClosedEnv('linux', {}, {})).toEqual({});
  });

  it('RF-I8: sin extra y en Linux la clave Path en minúsculas no se toma', () => {
    expect(buildClosedEnv('linux', { Path: '/x' })).toEqual({});
  });
});
