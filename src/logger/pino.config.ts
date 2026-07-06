import { ConfigService } from '@nestjs/config';
import { Params } from 'nestjs-pino';
import crypto from 'node:crypto';

const loggerConfig = (configService: ConfigService): Params => {
  const nodeEnv = configService.get<string>('app.env') ?? 'development';
  const logLevel = configService.get<string>('app.logLevel') ?? 'info';

  return {
    pinoHttp: {
      level: logLevel,

      transport:
        nodeEnv === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                singleLine: true,
                translateTime: 'UTC:dd-mm-yyyy HH:MM:ss.l',
              },
            }
          : undefined,

      genReqId: (req, res) => {
        const requestId =
          req.headers['x-request-id'] ||
          req.headers['x-correlation-id'] ||
          crypto.randomUUID();

        res.setHeader('x-request-id', requestId);

        return requestId;
      },

      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["x-api-key"]',
          'req.body.password',
          'req.body.passwordConfirm',
          'req.body.accessToken',
          'req.body.refreshToken',
          'req.body.token',
          'req.body.secret',
          'req.body.jwt',
        ],
        censor: '[REDACTED]',
      },

      serializers: {
        req: (req) => ({
          id: req.id,
          method: req.method,
          url: req.url,
          ip: req.ip,
        }),

        res: (res) => ({
          statusCode: res.statusCode,
        }),
      },

      customProps: (req) => ({
        requestId: req.id,
      }),
    },
  };
};

export default loggerConfig;
