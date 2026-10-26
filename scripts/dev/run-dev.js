import { attachPrefixed } from '../lib/prefixed-output.js';
import { findBusyPorts, findMissingFiles } from './checks.js';
import { buildCommands } from './commands.js';

/**
 * @typedef {import('../lib/process-tree.js').Child} Child
 * @typedef {import('./commands.js').CommandSpec} CommandSpec
 * @typedef {{
 *   env: Record<string, string | undefined>,
 *   execPath: string,
 *   write: (text: string) => void,
 *   fileExists: (file: string) => boolean,
 *   isPortFree: (port: number, host: string) => Promise<boolean>,
 *   startChild: (spec: CommandSpec & { platform: string }) => Child,
 *   killTree: (child: Child, options: { platform: string }) => Promise<void>,
 *   onSignal: (handler: () => void) => () => void,
 * }} DevDeps
 * @typedef {{ kind: 'exit', child: Child, info: import('../lib/process-tree.js').ExitInfo } | { kind: 'stop' }} Outcome
 */

/**
 * Cómo dejó el proceso, sin más datos que el código, la señal o el código de error de lanzamiento.
 * @param {import('../lib/process-tree.js').ExitInfo} info
 * @returns {string}
 */
function describeExit({ code, signal, errorCode }) {
  if (errorCode !== undefined) return `no pudo lanzarse (${errorCode})`;
  if (code !== null) return `terminó (código ${code})`;
  return `terminó (señal ${signal})`;
}

/**
 * Arranque conjunto: base de datos, compilación del backend, backend y frontend. Todo o nada: si algo falla o
 * termina se detiene lo demás y el código es 1; con Ctrl+C se detienen los procesos propios y el código es 0.
 * Nunca se ejecuta `down` ni se toca el volumen de la base de datos.
 * @param {{ root: string, platform: string, deps: DevDeps }} options
 * @returns {Promise<number>} código de salida
 */
export async function runDev({ root, platform, deps }) {
  const say = (/** @type {string} */ text) => deps.write(`[dev] ${text}\n`);
  const problems = [
    ...findMissingFiles({ root, fileExists: deps.fileExists }),
    ...(await findBusyPorts({ isPortFree: deps.isPortFree })),
  ];
  if (problems.length > 0) {
    problems.forEach(say);
    return 1;
  }

  const commands = buildCommands({ root, platform, parentEnv: deps.env, execPath: deps.execPath });
  /** @type {() => void} */
  let requestStop = () => {};
  const stopRequested = new Promise((resolve) => {
    requestStop = () => resolve({ kind: 'stop' });
  });
  const dispose = deps.onSignal(() => requestStop());

  const start = (/** @type {CommandSpec} */ spec) => {
    const child = deps.startChild({ ...spec, platform });
    attachPrefixed(child, deps.write);
    return child;
  };

  /**
   * Detiene los hijos dados; si alguno no se deja detener, escribe el motivo.
   * @param {Child[]} children
   * @returns {Promise<boolean>} true si todos se detuvieron
   */
  const stopAll = async (children) => {
    const results = await Promise.allSettled(children.map((child) => deps.killTree(child, { platform })));
    for (const result of results) {
      if (result.status === 'rejected') say(result.reason.message);
    }
    return results.every((result) => result.status === 'fulfilled');
  };

  /**
   * @param {Child} child
   * @returns {Promise<Outcome>}
   */
  const exitOf = async (child) => ({ kind: 'exit', child, info: await child.exited });

  /**
   * Ejecuta un paso que debe terminar bien antes de seguir (base de datos, compilación).
   * @param {CommandSpec} spec
   * @returns {Promise<number | undefined>} código de salida de runDev si hay que parar; undefined si sigue
   */
  const runStep = async (spec) => {
    const child = start(spec);
    const outcome = /** @type {Outcome} */ (await Promise.race([exitOf(child), stopRequested]));
    if (outcome.kind === 'stop') return (await stopAll([child])) ? 0 : 1;
    if (outcome.info.code === 0) return undefined;
    say(`El proceso ${child.name} ${describeExit(outcome.info)}`);
    return 1;
  };

  try {
    const early = (await runStep(commands.db)) ?? (await runStep(commands.build));
    if (early !== undefined) return early;

    const backend = start(commands.backend);
    const frontend = start(commands.frontend);
    const outcome = /** @type {Outcome} */ (await Promise.race([exitOf(backend), exitOf(frontend), stopRequested]));
    if (outcome.kind === 'stop') return (await stopAll([backend, frontend])) ? 0 : 1;
    say(`El proceso ${outcome.child.name} ${describeExit(outcome.info)}`);
    await stopAll([outcome.child === backend ? frontend : backend]);
    return 1;
  } finally {
    dispose();
  }
}
