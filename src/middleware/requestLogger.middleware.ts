import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction, response } from 'express';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, body, query, params } = req;

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    const userAgent = req.headers['user-agent'];

    this.logger.log(
      `Incoming Request:
      Method: ${method}
      URL: ${originalUrl}
      IP: ${ip}
      User-Agent: ${userAgent}
      Query: ${JSON.stringify(query)}
      Params: ${JSON.stringify(params)}
      Body: ${JSON.stringify(body)}
      Cookies: ${JSON.stringify(req.cookies)}
      `,
    );

    next();
  }
}
