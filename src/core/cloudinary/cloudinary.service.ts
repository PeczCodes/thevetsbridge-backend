import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);
  private cloudName: string;
  private apiKey: string;
  private apiSecret: string;

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const cloudinaryUrl = this.configService.getOrThrow<string>('cloudinary.url');
    try {
      const match = cloudinaryUrl.match(/cloudinary:\/\/([^:]+):([^@]+)@(.+)/);
      if (!match) {
        throw new Error('Invalid CLOUDINARY_URL format. Expected: cloudinary://api_key:api_secret@cloud_name');
      }
      [, this.apiKey, this.apiSecret, this.cloudName] = match;
      this.logger.log(`Cloudinary configured successfully for cloud: ${this.cloudName}`);
    } catch (error: any) {
      this.logger.error(`Failed to parse CLOUDINARY_URL: ${error.message}`);
    }
  }

  generateSignature(folder: string, publicId?: string) {
    if (!this.apiSecret || !this.apiKey || !this.cloudName) {
      throw new Error('Cloudinary is not configured on the server.');
    }

    const timestamp = Math.round(new Date().getTime() / 1000);
    const paramsToSign: Record<string, any> = {
      folder,
      timestamp,
    };

    if (publicId) {
      paramsToSign.public_id = publicId;
    }

    // Sort parameters alphabetically
    const sortedParams = Object.keys(paramsToSign)
      .sort()
      .map(key => `${key}=${paramsToSign[key as keyof typeof paramsToSign]}`)
      .join('&');

    // Hash with SHA-1
    const signature = crypto
      .createHash('sha1')
      .update(sortedParams + this.apiSecret)
      .digest('hex');

    return {
      signature,
      timestamp,
      apiKey: this.apiKey,
      cloudName: this.cloudName,
      folder,
      ...(publicId && { public_id: publicId }),
    };
  }

  /**
   * Permanently deletes an asset from Cloudinary by its public_id.
   * Must be called server-side because it requires the api_secret.
   */
  async deleteAsset(publicId: string): Promise<{ result: string }> {
    if (!this.apiSecret || !this.apiKey || !this.cloudName) {
      throw new Error('Cloudinary is not configured on the server.');
    }

    const timestamp = Math.round(new Date().getTime() / 1000);

    const paramsToSign = `public_id=${publicId}&timestamp=${timestamp}`;
    const signature = crypto
      .createHash('sha1')
      .update(paramsToSign + this.apiSecret)
      .digest('hex');

    const formData = new URLSearchParams();
    formData.append('public_id', publicId);
    formData.append('api_key', this.apiKey);
    formData.append('timestamp', timestamp.toString());
    formData.append('signature', signature);

    const url = `https://api.cloudinary.com/v1_1/${this.cloudName}/image/destroy`;

    const res = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err?.error?.message || 'Cloudinary delete request failed');
    }

    const data = await res.json();
    this.logger.log(`Cloudinary asset deleted: ${publicId} — result: ${data.result}`);
    return data;
  }
}
