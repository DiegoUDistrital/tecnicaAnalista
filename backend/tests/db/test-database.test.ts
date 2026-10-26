import { describe, expect, it } from 'vitest';
import { getTestDatabase } from '../helpers/test-database';

describe('RNF-4: helper de la base de pruebas', () => {
  it('RNF-4: se conecta con las tres URL y current_user coincide con cada rol', async () => {
    const database = getTestDatabase();
    const connections = [
      ['owner', await database.ownerClient()],
      ['writer', await database.writerClient()],
      ['reader', await database.readerClient()],
    ] as const;
    try {
      for (const [role, client] of connections) {
        const result = await client.query<{ current_user: string }>('SELECT current_user');
        expect(result.rows[0]?.current_user).toBe(role);
      }
    } finally {
      await Promise.all(connections.map(([, client]) => client.end()));
    }
  });
});
