import { registerAs } from '@nestjs/config';

interface RedisConfig {
  host: string;
  port: number;
  password?: string;
  url?: string;
}

export const redisConfig = registerAs('redis', (): RedisConfig => {
  let host = process.env.REDIS_HOST;
  let port = process.env.REDIS_PORT ? parseInt(process.env.REDIS_PORT, 10) : undefined;
  let password = process.env.REDIS_PASSWORD;
  const url = process.env.REDIS_URL;

  if (url) {
    try {
      const parsed = new URL(url);
      host = host || parsed.hostname;
      port = port || (parsed.port ? parseInt(parsed.port, 10) : 6379);
      if (!password && parsed.password) {
        password = parsed.password;
      }
    } catch {}
  }

  return {
    host: host || 'localhost',
    port: port || 6379,
    password: password || undefined,
    url,
  };
});




