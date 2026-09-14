import { sqliteTable, text, integer, index, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
export const workspaceRevision = sqliteTable('workspace_revision', {id: text('id').primaryKey(), revision: integer('revision').notNull().default(0)});
export const records = sqliteTable('records', {id: text('id').primaryKey(), kind: text('kind').notNull(), data: text('data').notNull()}, t=>[index('idx_records_kind').on(t.kind)]);
// A failed compare-and-swap must abort the whole D1 batch, including audit entries.
export const transactionGuards = sqliteTable('transaction_guards', {id:text('id').primaryKey(), valid:integer('valid').notNull()},t=>[check('revision_must_match',sql`${t.valid} = 1`)]);
