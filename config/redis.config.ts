import { registerAs } from '@nestjs/config';

interface RedisConfig {
  host: string;
  port: number;
  password: string;
}

export const redisConfig = registerAs('redis', (): RedisConfig => ({
    host: process.env.REDIS_HOST!,
    port: parseInt(process.env.REDIS_PORT!, 10),
    password: process.env.REDIS_PASSWORD!
  }),
);




