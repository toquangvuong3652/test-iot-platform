import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from "@nestjs/common";
import type { Request, Response } from "express";

/**
 * Maps every exception to the standard envelope { data: null, error: { code, message } }.
 * 4xx keep their status; 5xx collapse to a generic message (no stack leak).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const message =
        typeof body === "string"
          ? body
          : ((body as { message?: string | string[] }).message ??
            exception.message);
      const code = this.codeFor(status);
      res.status(status).json({
        data: null,
        error: { code, message: Array.isArray(message) ? message.join(", ") : message },
      });
      return;
    }

    this.logger.error(
      `${req.method} ${req.url} -> 500`,
      exception instanceof Error ? exception.stack : String(exception),
    );
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      data: null,
      error: { code: "internal", message: "Internal server error" },
    });
  }

  private codeFor(status: number): string {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return "unauthorized";
      case HttpStatus.FORBIDDEN:
        return "forbidden";
      case HttpStatus.NOT_FOUND:
        return "not_found";
      case HttpStatus.CONFLICT:
        return "conflict";
      case HttpStatus.BAD_REQUEST:
        return "bad_request";
      default:
        return `error_${status}`;
    }
  }
}
