import { Container, getContainer } from '@cloudflare/containers';

/**
 * The render engine, unchanged, inside a container.
 * sleepAfter keeps a warm instance around between bursts: its in-memory caches and
 * preloaded mockup bundles are what make a repeat render ~0.1 ms instead of ~25 ms.
 */
export class RenderContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '5m';
  envVars = { NODE_ENV: 'production' };
}

/** How many container instances to spread load over. Must be <= max_instances in wrangler.jsonc. */
const SHARDS = 2;

/** Stable shard per distinct image URL: the same personalisation always lands on the
 *  same instance, so that instance's memory cache actually gets hit. */
function shardFor(url) {
  const key = url.pathname + url.search;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  return `render-${(h >>> 0) % SHARDS}`;
}

const CACHEABLE = /^\/(render|i|artwork|assets)\b/;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const cacheable = request.method === 'GET' && CACHEABLE.test(url.pathname);

    // 1) Cloudflare edge cache — never reaches the container, never costs container CPU
    if (cacheable) {
      const hit = await caches.default.match(request);
      if (hit) {
        const out = new Response(hit.body, hit);
        out.headers.set('x-cache', 'HIT');
        return out;
      }
    }

    // 2) miss -> the container renders it
    const container = getContainer(env.RENDER, shardFor(url));
    const res = await container.fetch(request);

    if (cacheable && res.ok) {
      const body = await res.arrayBuffer();
      const cached = new Response(body, res);
      cached.headers.set('x-cache', 'MISS');
      // s-maxage from the origin drives how long the edge keeps it
      ctx.waitUntil(caches.default.put(request, cached.clone()));
      return cached;
    }
    return res;
  },
};
