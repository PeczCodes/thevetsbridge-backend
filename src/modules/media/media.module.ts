import { Module } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaController } from './media.controller';
import { FolderResolver } from './resolver/folder.resolver';
import { STORAGE_ADAPTER } from './ports/storage-adapter.interface';
import { CloudinaryAdapter } from '../../cloudinary/cloudinary.adapter';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    FolderResolver,
    {
      provide: STORAGE_ADAPTER,
      useClass: CloudinaryAdapter,
    },
  ],
  exports: [MediaService, STORAGE_ADAPTER],
})
export class MediaModule {}
