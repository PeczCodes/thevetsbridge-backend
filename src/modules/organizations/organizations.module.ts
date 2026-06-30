import { Module } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { OrganizationMembersService } from './services/organization-members.service';
import { OrganizationsController } from './organizations.controller';
import { PrismaModule } from '../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService, OrganizationMembersService],
  exports: [OrganizationsService, OrganizationMembersService],
})
export class OrganizationsModule {}
