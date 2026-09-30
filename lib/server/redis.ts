import "server-only";
import { Redis } from "@upstash/redis";
import type { RedisLike } from "@/lib/game/store";
import { ConfigError, REDIS_HELP, env } from "./env";

let client: RedisLike | null = null;

/**
 * Connects to Redis in whichever form the project provides:
 *  1. Upstash REST URL + token (UPSTASH_REDIS_REST_* or KV_REST_API_*, with or without a prefix)
 *  2. an Upstash redis:// / rediss:// URL (KV_URL): converted to the REST form
 *  3. any other redis:// URL (e.g. Vercel's "Redis" integration): a regular connection via ioredis
 */
export function getRedis(): RedisLike {
  if (client) return client;
  let url = env.redisUrl;
  let token = env.redisToken;
  const tcp = env.redisTcpUrl;

  if (!(url && token) && tcp) {
    try {
      const u = new URL(tcp);
      if (u.hostname.endsWith(".upstash.io") && u.password) {
        url = `https://${u.hostname}`;
        token = decodeURIComponent(u.password);
      }
    } catch {
      /* not a URL; handled below */
    }
  }

  if (url && token) {
    client = new Redis({ url, token, automaticDeserialization: false }) as unknown as RedisLike;
    return client;
  }
  if (tcp) {
    client = tcpRedis(tcp);
    return client;
  }
  throw new ConfigError(REDIS_HELP);
}

/** RedisLike over a standard Redis connection (ioredis), loaded only when needed. */
function tcpRedis(connection: string): RedisLike {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const IORedis = require("ioredis");
  const r = new (IORedis.default ?? IORedis)(connection, { maxRetriesPerRequest: 2, enableReadyCheck: false });
  return {
    get: (k) => r.get(k),
    set: (k, v, o) => {
      const args: (string | number)[] = [];
      if (o?.ex) args.push("EX", o.ex);
      if (o?.nx) args.push("NX");
      return r.set(k, v, ...args);
    },
    del: (...ks) => r.del(...ks),
    hget: (k, f) => r.hget(k, f),
    hset: (k, kv) => r.hset(k, kv),
    hsetnx: (k, f, v) => r.hsetnx(k, f, v),
    hvals: (k) => r.hvals(k),
    hdel: (k, ...f) => r.hdel(k, ...f),
    hlen: (k) => r.hlen(k),
    expire: (k, s) => r.expire(k, s),
    incr: (k) => r.incr(k),
    sadd: (k, m) => r.sadd(k, m),
    srem: (k, m) => r.srem(k, m),
    smembers: (k) => r.smembers(k),
    mget: (...ks) => r.mget(...ks),
    eval: (script, keys, args) => r.eval(script, keys.length, ...keys, ...args),
  };
}
