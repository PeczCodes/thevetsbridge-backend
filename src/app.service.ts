import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getRoot() {
    return {
      name: 'VetsBridge API',
      description:
        'Production-grade veterinary telemedicine and e-commerce platform API.',
      version: '1.0.0',
      environment: process.env.NODE_ENV,
      docs: '/api/docs',
      timestamp: new Date().toISOString(),
    };
  }
}
