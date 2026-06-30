import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AdminService } from './modules/admin/admin.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const adminService = app.get(AdminService);
  const stats = await adminService.getStats();
  console.log('STATS RESULT:', JSON.stringify(stats, null, 2));
  await app.close();
}

bootstrap().catch(err => {
  console.error(err);
  process.exit(1);
});
