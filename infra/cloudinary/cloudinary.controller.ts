import { Controller, Get, Delete, Query, BadRequestException } from '@nestjs/common';
import { CloudinaryService } from './cloudinary.service';
import { CurrentUser } from '../../src/modules/identity/auth/decorators/current-user.decorator';

@Controller('cloudinary')
export class CloudinaryController {
  constructor(private readonly cloudinaryService: CloudinaryService) {}

  @Get('sign')
  async getSignature(
    @CurrentUser() user: any,
    @Query('folder') folder: string = 'vetsbridge/general',
    @Query('publicId') publicId?: string
  ) {
    return this.cloudinaryService.generateSignature(folder, publicId);
  }

  @Delete('delete')
  async deleteAsset(
    @CurrentUser() user: any,
    @Query('publicId') publicId: string,
  ) {
    if (!publicId) {
      throw new BadRequestException('publicId query parameter is required');
    }
    return this.cloudinaryService.deleteAsset(publicId);
  }
}
