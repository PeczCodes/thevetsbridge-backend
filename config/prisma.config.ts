import { registerAs } from '@nestjs/config';

export const prismaConfig = registerAs( 'prisma', () => ({
		database_url: process.env.DATABASE_URL
}))