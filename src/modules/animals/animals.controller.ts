import {
  Controller,
  Post,
  Body,
  Get,
  Delete,
  Param,
  Put,
  ForbiddenException,
} from '@nestjs/common';
import { AnimalsService } from './animals.service';
import { CreateAnimalDto } from './dto/create-animal.dto';
import { UpdateAnimalDto } from './dto/update-animal.dto';
import { CreateAnimalHealthLogDto } from './dto/create-health-log.dto';
import { CurrentUser } from '../identity/auth/decorators/current-user.decorator';
import { MediaService } from '../media/media.service';
import { MediaOwnerType, MediaResourceType } from '@prisma/client';

@Controller('animals')
export class AnimalsController {
  constructor(
    private readonly animalsService: AnimalsService,
    private readonly mediaService: MediaService,
  ) {}

  @Post()
  async createAnimal(@CurrentUser() user: any, @Body() dto: CreateAnimalDto) {
    return this.animalsService.createAnimal(user.id, dto);
  }

  @Get()
  async getMyAnimals(@CurrentUser() user: any) {
    return this.animalsService.getUserAnimals(user.id);
  }

  @Get(':id')
  async getAnimal(@CurrentUser() user: any, @Param('id') id: string) {
    return this.animalsService.getAnimalById(user, id);
  }

  @Put(':id')
  async updateAnimal(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateAnimalDto,
  ) {
    return this.animalsService.updateAnimal(user, id, dto);
  }

  @Delete(':id')
  async deleteAnimal(@CurrentUser() user: any, @Param('id') id: string) {
    return this.animalsService.deleteAnimal(user.id, id);
  }

  @Post(':id/profile/upload-intent')
  async getProfileUploadIntent(
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    const isOwner = await this.animalsService.isOwner(user.id, id);
    if (!isOwner) {
      throw new ForbiddenException('You do not own this animal');
    }

    return this.mediaService.createUploadIntent({
      ownerType: MediaOwnerType.ANIMAL,
      ownerId: id,
      resourceType: MediaResourceType.PROFILE_IMAGE,
      uploaderId: user.id,
    });
  }

  @Post(':animalId/health-logs')
  async addHealthLog(
    @CurrentUser() user: any,
    @Param('animalId') animalId: string,
    @Body() dto: CreateAnimalHealthLogDto,
  ) {
    return this.animalsService.addHealthLog(user, animalId, dto);
  }

  @Get(':animalId/health-logs')
  async getHealthLogs(
    @CurrentUser() user: any,
    @Param('animalId') animalId: string,
  ) {
    return this.animalsService.getHealthLogs(user, animalId);
  }

  @Delete(':animalId/health-logs/:logId')
  async deleteHealthLog(
    @CurrentUser() user: any,
    @Param('animalId') animalId: string,
    @Param('logId') logId: string,
  ) {
    return this.animalsService.deleteHealthLog(user, animalId, logId);
  }
}
