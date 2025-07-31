import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const connectionString = process.env.DATABASE_URL;
let db: ReturnType<typeof drizzle> | null = null;

if (connectionString) {
  const client = postgres(connectionString, { ssl: 'require' });
  db = drizzle(client);
}

export default db;
