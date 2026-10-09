import { it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { createPostSchema } from './modules/posts/posts.schema.js';
import { buildApp } from './server.js';
it('OpenAPI references resolve and documented post example validates', async () => {
  const doc = JSON.parse(readFileSync('docs/openapi.yaml', 'utf8'));
  expect(doc.openapi).toBe('3.1.0');
  const walk = (node: any) => {
    if (!node || typeof node !== 'object') return;
    if (node.$ref) {
      let target: any = doc;
      for (const p of node.$ref.slice(2).split('/')) target = target?.[p];
      expect(target, node.$ref).toBeDefined();
    }
    for (const value of Object.values(node)) walk(value);
  };
  walk(doc);
  expect(
    createPostSchema.safeParse(doc.components.schemas.CreatePost.example)
      .success,
  ).toBe(true);
  const app = buildApp();
  await app.ready();
  for (const [path, methods] of Object.entries(doc.paths)) {
    for (const method of Object.keys(methods as any))
      expect(
        app.hasRoute({
          method: method.toUpperCase() as any,
          url: path.replace(/\{(\w+)\}/g, ':$1'),
        }),
        method + ' ' + path,
      ).toBe(true);
  }
  await app.close();
});
it('README links point to existing local documentation', () => {
  const text = readFileSync('README.md', 'utf8');
  for (const m of text.matchAll(/\]\((docs\/[^)]+)\)/g))
    expect(existsSync(m[1]), m[1]).toBe(true);
});
