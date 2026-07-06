import { HttpException, HttpStatus } from '@nestjs/common';

export interface ExternalServiceExceptionOptions {
  provider: string;
  message: string;
  retryable: boolean;
  statusCode?: number;
  reason?: any;
}

export class ExternalServiceException extends HttpException {
  public readonly provider: string;
  public readonly retryable: boolean;
  public readonly reason: any;

  constructor(options: ExternalServiceExceptionOptions) {
    const status = options.statusCode || HttpStatus.BAD_GATEWAY;
    super(
      {
        statusCode: status,
        message: options.message,
        provider: options.provider,
        retryable: options.retryable,
        reason: options.reason,
      },
      status,
    );
    this.provider = options.provider;
    this.retryable = options.retryable;
    this.reason = options.reason;
  }
}
