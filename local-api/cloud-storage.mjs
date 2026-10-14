import { AsyncLocalStorage } from 'node:async_hooks';
import { createClient } from '@libsql/client';

// Isolate concurrent requests' transactions in a shared Vercel function.
export function createCloudStorage({ url, authToken } = {}) {
  const client = createClient({ url, authToken, intMode: 'number' });
  const context = new AsyncLocalStorage();
  const execute = (sql, args) => (context.getStore() || client).execute({ sql, args });
  return {
    async exec(schema) {
      const statements = schema.split(';').map(sql => sql.trim()).filter(sql => sql && !/^PRAGMA /i.test(sql));
      await client.batch(statements, 'write');
    },
    prepare(sql) {
      return {
        all: async (...args) => (await execute(sql, args)).rows,
        get: async (...args) => (await execute(sql, args)).rows[0],
        run: async (...args) => execute(sql, args),
      };
    },
    async transaction(callback) {
      const transaction = await client.transaction('write');
      try {
        const result = await context.run(transaction, callback);
        await transaction.commit();
        return result;
      } catch (error) {
        await transaction.rollback();
        throw error;
      } finally {
        transaction.close();
      }
    },
    close() { client.close(); },
  };
}
