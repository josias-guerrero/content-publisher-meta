import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const accounts = sqliteTable('accounts', {
  id: text('id').primaryKey(), // UUID
  platform: text('platform', { enum: ['instagram', 'facebook'] }).notNull(),
  external_id: text('external_id').notNull(),
  name: text('name'),
  access_token: text('access_token').notNull(), // cifrado
  token_expires_at: integer('token_expires_at').notNull(), // unix timestamp
  created_at: integer('created_at').notNull(),
});

export const posts = sqliteTable('posts', {
  id: text('id').primaryKey(), // UUID
  account_id: text('account_id')
    .notNull()
    .references(() => accounts.id, { onDelete: 'cascade' }),
  caption: text('caption'),
  media_urls: text('media_urls').notNull(), // JSON array serializado
  type: text('type', {
    enum: ['post', 'reels', 'story'],
  }),
  scheduled_at: integer('scheduled_at').notNull(), // unix timestamp
  status: text('status', {
    enum: ['pending', 'publishing', 'published', 'failed'],
  }).notNull(),
  container_id: text('container_id'),
  error_message: text('error_message'),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});
