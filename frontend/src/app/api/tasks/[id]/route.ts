import { defaultDeps } from '../../../../server/proxy/default-deps';
import { createRouteHandler } from '../../../../server/proxy/handlers';

// Respuestas siempre calculadas en cada petición; nunca se prerrenderizan ni se guardan.
export const dynamic = 'force-dynamic';

// Se exportan TODOS los métodos para que Next no genere `OPTIONS` ni `HEAD` por su cuenta: los no soportados
// (todos salvo PUT y DELETE) reciben el 405 propio del manejador.
const handler = createRouteHandler('item', defaultDeps());

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const DELETE = handler;
export const PATCH = handler;
export const HEAD = handler;
export const OPTIONS = handler;
