import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';

@Injectable()
export class HashingService {
	
	async hash(password: string): Promise<string> {
		try {
			return await argon2.hash(password);
		} catch (error) {
			throw new Error('Failed to hash password');
		}
	}
	
	async verify(hash: string, plain: string): Promise<boolean> {
		try {
			return await argon2.verify(hash, plain);
		} catch (error) {
			throw new Error('Failed to verify password');
		}
	}
}