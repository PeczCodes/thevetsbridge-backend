import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly key: Buffer;

  constructor(private readonly configService: ConfigService) {
    const rawSecret = this.configService.get<string>('ENCRYPTION_SECRET') || this.configService.get<string>('JWT_ACCESS_SECRET');
    if (!rawSecret) {
      throw new Error('Encryption secret could not be resolved (neither ENCRYPTION_SECRET nor JWT_ACCESS_SECRET is set)');
    }
    // Derive a cryptographically secure 32-byte key from the configured secret via SHA-256
    this.key = crypto.createHash('sha256').update(rawSecret).digest();
  }

  encrypt(text: string): string {
    const iv = crypto.randomBytes(12); // GCM standard IV size is 12 bytes
    const cipher = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag().toString('hex');
    
    // Combine iv, encrypted text, and auth tag as colon-separated format
    return `${iv.toString('hex')}:${encrypted}:${tag}`;
  }

  decrypt(encryptedText: string): string {
    try {
      const parts = encryptedText.split(':');
      if (parts.length !== 3) {
        throw new Error('Invalid encrypted format (expected 3 parts)');
      }
      
      const iv = Buffer.from(parts[0], 'hex');
      const encrypted = parts[1];
      const tag = Buffer.from(parts[2], 'hex');
      
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      decipher.setAuthTag(tag);
      
      let decrypted = decipher.update(encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    } catch (error: any) {
      this.logger.error(`Decryption failed: ${error.message}`);
      throw new Error(`Failed to decrypt data: ${error.message}`);
    }
  }
}
