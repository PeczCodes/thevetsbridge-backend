import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { MonitoringService } from '../monitoring.service';
import { EXCEPTIONS_TOTAL } from '../metrics/health.metrics';

@InjectableFilter()
export class ExceptionMonitoringFilter implements ExceptionFilter {
  private readonly logger = new Logger(ExceptionMonitoringFilter.name);

  constructor(private readonly monitoringService: MonitoringService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionType = isHttpException
      ? exception.constructor.name
      : (exception as Error)?.name || 'UnhandledError';

    const isHandled = isHttpException && status < 500;
    const category = this.determineCategory(exception, isHttpException, status);

    // Record Exception Metric
    this.monitoringService.incrementCounter(EXCEPTIONS_TOTAL, 1, {
      exception_type: exceptionType,
      status_code: String(status),
      is_handled: String(isHandled),
      category,
    });

    if (!isHttpException) {
      this.logger.error(
        `Unhandled exception caught during ${request?.method} ${request?.url}: ${(exception as Error)?.stack || exception}`,
      );
    }

    if (response && typeof response.status === 'function') {
      const responseBody = isHttpException
        ? exception.getResponse()
        : {
            statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
            message: 'Internal server error',
          };

      response.status(status).json(
        typeof responseBody === 'object'
          ? responseBody
          : { statusCode: status, message: responseBody },
      );
    }
  }

  private determineCategory(exception: unknown, isHttp: boolean, status: number): string {
    const name = (exception as Error)?.name || '';
    const constructorName = exception?.constructor?.name || '';

    if (name.includes('Prisma') || constructorName.includes('Prisma')) {
      return 'prisma';
    }
    if (name.includes('Redis') || constructorName.includes('Redis')) {
      return 'redis';
    }
    if (name.includes('Bull') || constructorName.includes('Bull')) {
      return 'bullmq';
    }
    if (exception instanceof BadRequestException || name.includes('Zod') || name.includes('Validation')) {
      return 'validation';
    }
    if (!isHttp || status >= 500) {
      return 'unhandled';
    }
    return 'http';
  }
}

function InjectableFilter(): ClassDecorator {
  return (target: any) => {
    Catch()(target);
  };
}
