import {
  Controller,
  Post,
  Body,
  Get,
  Param,
  Query,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { DirectMessagingService } from './direct-messaging.service';
import { CurrentUser } from '../../identity/auth/decorators/current-user.decorator';
import { RequireProfile } from '../../identity/auth/decorators/require-profile.decorator';
import { RequireProfileGuard } from '../../identity/auth/guards/require-profile.guard';
import { PaginationDto } from '../../../../common/dto/pagination.dto';

@Controller('direct-messages')
export class DirectMessagingController {
  constructor(
    private readonly directMessagingService: DirectMessagingService,
  ) {}

  @Post('channels')
  async getOrCreateChannel(
    @CurrentUser() user: any,
    @Body('vetId') vetId: string,
  ) {
    return this.directMessagingService.getOrCreateChannel(user.id, vetId);
  }

  @Get('channels/:id/messages')
  async getMessages(
    @Param('id') id: string,
    @CurrentUser() user: any,
    @Query() pagination: PaginationDto,
  ) {
    return this.directMessagingService.getChannelMessages(
      user.id,
      id,
      pagination,
    );
  }

  @Patch('settings')
  @RequireProfile('VET')
  @UseGuards(RequireProfileGuard)
  async updateSettings(
    @CurrentUser() user: any,
    @Body('enabled') enabled: boolean,
    @Body('price') price: number,
  ) {
    return this.directMessagingService.toggleDirectMessaging(
      user.vetProfile.id,
      enabled,
      price,
    );
  }
}
