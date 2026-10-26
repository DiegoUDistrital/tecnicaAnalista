import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Sin `globals` Testing Library no limpia el DOM solo: se hace aquí tras cada prueba.
afterEach(cleanup);
