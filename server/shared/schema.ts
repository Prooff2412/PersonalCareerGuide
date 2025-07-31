import { serial, varchar, timestamp, pgTable } from 'drizzle-orm/pg-core';

/**
 * Eksempel på en Drizzle-tabel.
 * Du kan tilføje flere tabeller efter behov, fx 'careers', 'skills' osv.
 */
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow()
});

// Tilføj fremtidige tabeller her...
