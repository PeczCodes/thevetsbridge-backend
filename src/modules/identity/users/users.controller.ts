import { Controller, Patch, Post, Delete, Body } from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MediaService } from '../../media/media.service';
import { MediaOwnerType, MediaResourceType } from '@prisma/client';

@Controller('identity')
export class UsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly mediaService: MediaService,
  ) {}

  @Patch('me')
  async updateProfile(@CurrentUser() user: any, @Body() dto: UpdateProfileDto) {
    return this.usersService.updateProfile(user.id, dto);
  }

  @Post('me/avatar/upload-intent')
  async getAvatarUploadIntent(@CurrentUser() user: any) {
    return this.mediaService.createUploadIntent({
      ownerType: MediaOwnerType.USER,
      ownerId: user.id,
      resourceType: MediaResourceType.PROFILE_IMAGE,
      uploaderId: user.id,
    });
  }

  @Delete('me')
  async deleteAccount(@CurrentUser() user: any, @Body() dto: DeleteAccountDto) {
    return this.usersService.deleteAccount(user.id, dto);
  }

  @Delete('me/vet')
  async deleteVetProfile(
    @CurrentUser() user: any,
    @Body() dto: DeleteAccountDto,
  ) {
    return this.usersService.deleteVetProfile(user.id, dto);
  }

  @Delete('me/vendor')
  async deleteVendorProfile(
    @CurrentUser() user: any,
    @Body() dto: DeleteAccountDto,
  ) {
    return this.usersService.deleteVendorProfile(user.id, dto);
  }
}
