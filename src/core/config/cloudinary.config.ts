import { registerAs } from '@nestjs/config';

export const cloudinaryConfig = registerAs('cloudinary', () => ({
  url: process.env.CLOUDINARY_URL,
}));
