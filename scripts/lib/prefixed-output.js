/**
 * @param {string} line
 * @returns {string} la línea sin el retorno de carro final (salida de Windows)
 */
function withoutCarriageReturn(line) {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Reparte la salida de un proceso por líneas y escribe cada una con el prefijo `[nombre] `.
 * Un trozo puede traer media línea: se guarda hasta que llegue el salto de línea o se cierre el flujo.
 * stdout y stderr comparten prefijo pero cada uno tiene su propio resto pendiente.
 * @param {{ name: string, stdout: NodeJS.ReadableStream, stderr: NodeJS.ReadableStream }} child
 * @param {(text: string) => void} write
 * @returns {void}
 */
export function attachPrefixed(child, write) {
  const prefix = `[${child.name}] `;
  for (const stream of [child.stdout, child.stderr]) {
    let pending = '';
    stream.setEncoding('utf8');
    stream.on('data', (/** @type {string} */ chunk) => {
      const text = pending + chunk;
      const lastBreak = text.lastIndexOf('\n');
      pending = text.slice(lastBreak + 1);
      if (lastBreak === -1) return;
      for (const line of text.slice(0, lastBreak).split('\n')) write(`${prefix}${withoutCarriageReturn(line)}\n`);
    });
    stream.on('end', () => {
      if (pending !== '') write(`${prefix}${withoutCarriageReturn(pending)}\n`);
    });
  }
}
