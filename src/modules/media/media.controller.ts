import {
  Controller,
  Post,
  Body,
  Headers,
  BadRequestException,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MediaService } from './media.service';

@Controller('media')
export class MediaController {
  private readonly logger = new Logger(MediaController.name);

  constructor(private readonly mediaService: MediaService) {}

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  async confirmUpload(
    @Body('intentId') intentId: string,
    @Body('publicId') publicId: string,
  ) {
    if (!intentId || !publicId) {
      throw new BadRequestException('intentId and publicId are required');
    }

    try {
      this.logger.log(
        `Manual upload confirmation for intent: ${intentId}, publicId: ${publicId}`,
      );
      const media = await this.mediaService.completeUpload(intentId, publicId);
      return { success: true, media };
    } catch (err: any) {
      this.logger.error(`Failed to confirm upload: ${err.message}`);
      throw new BadRequestException(err.message);
    }
  }

  @Post('webhooks/cloudinary')
  @HttpCode(HttpStatus.OK)
  async handleCloudinaryWebhook(@Body() body: any) {
    this.logger.log(
      `Received Cloudinary webhook. Type: ${body.notification_type}`,
    );

    if (body.notification_type !== 'upload') {
      // Return 200 OK to Cloudinary to acknowledge receipt of other events
      return { received: true };
    }

    const publicId = body.public_id;
    // Extract context: key=value|key2=value2 -> parse it
    const contextStr = body.context?.custom?.context || '';
    const context: Record<string, string> = {};

    if (contextStr) {
      contextStr.split('|').forEach((pair: string) => {
        const [k, v] = pair.split('=');
        if (k && v) context[k] = v;
      });
    }

    const intentId = context['intent_id'];

    if (!intentId) {
      this.logger.warn(
        `Cloudinary webhook missing intent_id in custom context for public_id: ${publicId}`,
      );
      return { received: true, reason: 'no_intent_id' };
    }

    try {
      this.logger.log(
        `Processing webhook completion for intent: ${intentId}, publicId: ${publicId}`,
      );
      await this.mediaService.completeUpload(intentId, publicId);
      return { received: true };
    } catch (err: any) {
      this.logger.error(`Webhook completion failed: ${err.message}`);
      return { received: true, error: err.message };
    }
  }
}
