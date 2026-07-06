import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import {
  StorageAdapter,
  SignatureResponse,
  AssetMetadata,
} from '../modules/media/ports/storage-adapter.interface';
import { CircuitBreakerService } from '../../infra/circuit-breaker/circuit-breaker.service';
import { ExternalServiceException } from '../../infra/circuit-breaker/exceptions/external-service.exception';

@Injectable()
export class CloudinaryAdapter implements StorageAdapter {
  private readonly logger = new Logger(CloudinaryAdapter.name);
  private cloudName: string;
  private apiKey: string;
  private apiSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly circuitBreakerService: CircuitBreakerService,
  ) {
    const cloudinaryUrl = this.configService.get<string>('cloudinary.url');
    if (cloudinaryUrl) {
      const match = cloudinaryUrl.match(/cloudinary:\/\/([^:]+):([^@]+)@(.+)/);
      if (match) {
        [, this.apiKey, this.apiSecret, this.cloudName] = match;
      }
    }
  }

  async generateUploadSignature(
    publicId: string,
    folder: string,
    context: Record<string, string>,
  ): Promise<SignatureResponse> {
    if (!this.apiSecret || !this.apiKey || !this.cloudName) {
      throw new Error('Cloudinary is not configured on the server.');
    }

    const timestamp = Math.round(new Date().getTime() / 1000);

    // Format context: key=value|key2=value2
    const contextString = Object.entries(context)
      .map(([key, val]) => `${key}=${val}`)
      .join('|');

    const paramsToSign: Record<string, any> = {
      folder,
      public_id: publicId,
      timestamp,
      context: contextString,
    };

    // Sort parameters alphabetically
    const sortedParams = Object.keys(paramsToSign)
      .sort()
      .map((key) => `${key}=${paramsToSign[key]}`)
      .join('&');

    const signature = crypto
      .createHash('sha1')
      .update(sortedParams + this.apiSecret)
      .digest('hex');

    return {
      signature,
      timestamp,
      apiKey: this.apiKey,
      cloudName: this.cloudName,
      publicId,
      folder,
    };
  }

  async getAssetMetadata(publicId: string): Promise<AssetMetadata> {
    if (!this.apiSecret || !this.apiKey || !this.cloudName) {
      throw new Error('Cloudinary is not configured on the server.');
    }

    const auth = Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString(
      'base64',
    );
    const resourceTypes = ['image', 'video', 'raw'];
    let lastError: any = null;

    for (const resType of resourceTypes) {
      try {
        const url = `https://api.cloudinary.com/v1_1/${this.cloudName}/resources/${resType}/upload/${publicId}`;
        const response = await this.circuitBreakerService.execute(
          'cloudinary',
          async () => {
            const controller = new AbortController();
            const id = setTimeout(() => controller.abort(), 10000);
            try {
              return await fetch(url, {
                headers: {
                  Authorization: `Basic ${auth}`,
                },
                signal: controller.signal,
              });
            } finally {
              clearTimeout(id);
            }
          },
        );

        if (response.ok) {
          const data = await response.json();
          return {
            secureUrl: data.secure_url,
            bytes: data.bytes,
            format: data.format,
            width: data.width,
            height: data.height,
            duration: data.duration,
            etag: data.etag,
            version: String(data.version),
          };
        } else {
          lastError = new Error(
            `Metadata request failed with status ${response.status}`,
          );
        }
      } catch (err: any) {
        lastError = err;
      }
    }
    throw new ExternalServiceException({
      provider: 'cloudinary',
      message: `Failed to fetch Cloudinary metadata for publicId: ${publicId}. ${lastError?.message || ''}`,
      retryable:
        lastError?.name === 'AbortError' ||
        lastError?.code === 'ECONNRESET' ||
        lastError?.code === 'ETIMEDOUT',
      reason: lastError,
    });
  }

  async deleteAsset(publicId: string): Promise<void> {
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
      await this.circuitBreakerService.execute('cloudinary', async () => {
        const controller = new AbortController();
        const id = setTimeout(() => controller.abort(), 10000);
        try {
          const res = await fetch(url, {
            method: 'POST',
            body: formData,
            signal: controller.signal,
          });

          if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(
              err?.error?.message || 'Cloudinary delete request failed',
            );
          }
        } finally {
          clearTimeout(id);
        }
      });
      this.logger.log(`Cloudinary asset deleted: ${publicId}`);
    } catch (error: any) {
      this.logger.error(
        `Cloudinary delete asset failed in adapter for publicId "${publicId}". Error: ${error.message}`,
      );
      const isAbort =
        error.name === 'AbortError' ||
        error.message?.includes('timeout') ||
        error.message?.includes('Timed out');
      throw new ExternalServiceException({
        provider: 'cloudinary',
        message: `Cloudinary delete asset failed in adapter: ${error.message}`,
        retryable:
          isAbort || error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT',
        reason: error,
      });
    }
  }
}
