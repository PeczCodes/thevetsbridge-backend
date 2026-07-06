import { Module } from '@nestjs/common';
import { AnimalsService } from './animals.service';
import { AnimalsController } from './animals.controller';
import { PrismaModule } from '../../../infra/prisma/prisma.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [PrismaModule, OrganizationsModule, MediaModule],
  controllers: [AnimalsController],
  providers: [AnimalsService],
  exports: [AnimalsService],
})
export class AnimalsModule {}
