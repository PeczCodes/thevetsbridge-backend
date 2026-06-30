import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [PrismaModule, IdentityModule],
  controllers: [AdminController],
  providers: [AdminService],
  exports: [AdminService],
})
export class AdminModule {}
