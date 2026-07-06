import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { CircuitBreakerService } from '../../infra/circuit-breaker/circuit-breaker.service';
import { ExternalServiceException } from '../../infra/circuit-breaker/exceptions/external-service.exception';

@Injectable()
export class CloudinaryService implements OnModuleInit {
  private readonly logger = new Logger(CloudinaryService.name);
  private cloudName: string;
  private apiKey: string;
  private apiSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {}

  async onModuleInit() {
    const cloudinaryUrl = this.configService.get<string>('cloudinary.url');
    if (!cloudinaryUrl) {
      this.logger.warn(
        'Cloudinary URL is not configured. Upload endpoints may fail.',
      );
      return;
    }

    try {
      const match = cloudinaryUrl.match(/cloudinary:\/\/([^:]+):([^@]+)@(.+)/);
      if (!match) {
        throw new Error(
          'Invalid CLOUDINARY_URL format. Expected: cloudinary://api_key:api_secret@cloud_name',
        );
      }
      [, this.apiKey, this.apiSecret, this.cloudName] = match;

      // Test connectivity to Cloudinary using circuit breaker
      await this.circuitBreakerService.execute(
        'cloudinary',
        async () => {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), 2000);
          try {
            const res = await fetch(
              `https://api.cloudinary.com/v1_1/${this.cloudName}/ping`,
              {
                method: 'GET',
                signal: controller.signal,
              },
            );
            if (!res.ok) throw new Error(`Status: ${res.status}`);
            return res;
          } finally {
            clearTimeout(id);
          }
        },
        { timeout: 3000 },
      );

      this.logger.log('Cloudinary connected.');
    } catch (error: any) {
      this.logger.warn(
        `Cloudinary unavailable. Upload endpoints may fail. Error: ${error.message}`,
      );
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
      .map((key) => `${key}=${paramsToSign[key]}`)
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

    try {
      const res = await this.circuitBreakerService.execute(
        'cloudinary',
        async () => {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), 10000);
          try {
            return await fetch(url, {
              method: 'POST',
              body: formData,
              signal: controller.signal,
            });
          } finally {
            clearTimeout(id);
          }
        },
      );

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new ExternalServiceException({
          provider: 'cloudinary',
          message:
            err?.error?.message ||
            `Cloudinary delete request failed with status: ${res.status}`,
          retryable: res.status >= 500 || res.status === 429,
          statusCode: res.status,
          reason: err,
        });
      }

      const data = await res.json();
      this.logger.log(
        `Cloudinary asset deleted: ${publicId} — result: ${data.result}`,
      );
      return data;
    } catch (error: any) {
      this.logger.error(
        `Cloudinary delete asset failed for publicId "${publicId}". Error: ${error.message}`,
      );
      if (error instanceof ExternalServiceException) {
        throw error;
      }
      const isAbort =
        error.name === 'AbortError' ||
        error.message?.includes('timeout') ||
        error.message?.includes('Timed out');
      throw new ExternalServiceException({
        provider: 'cloudinary',
        message: `Cloudinary delete request failed: ${error.message}`,
        retryable:
          isAbort || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT',
        statusCode: isAbort ? 504 : 502,
        reason: error,
      });
    }
  }
}
