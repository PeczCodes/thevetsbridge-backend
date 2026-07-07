import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return project metadata', () => {
      const result = appController.getHello();
      expect(result).toHaveProperty('name', 'VetsBridge API');
      expect(result).toHaveProperty('environment', 'test');
      expect(result).toHaveProperty('docs', '/api/docs');
    });
  });
});
