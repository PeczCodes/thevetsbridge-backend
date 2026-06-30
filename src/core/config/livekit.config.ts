import { registerAs } from '@nestjs/config';

export const livekitConfig = registerAs('livekit', () => ({
  apiKey: process.env.LIVEKIT_API_KEY,
  apiSecret: process.env.LIVEKIT_API_SECRET,
  url: process.env.LIVEKIT_URL,
}));
