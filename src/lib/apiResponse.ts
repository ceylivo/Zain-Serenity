import { NextResponse } from "next/server";

export interface ApiErrorOptions {
  status?: number;
  code?: string;
  details?: unknown;
}

export function apiError(
  message: string,
  { status = 400, code = "BAD_REQUEST", details }: ApiErrorOptions = {}
) {
  return NextResponse.json(
    {
      error: {
        code,
        message,
        ...(details === undefined ? {} : { details }),
      },
    },
    { status }
  );
}

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function getRequestId(request: Request): string {
  return (
    request.headers.get("x-request-id") ||
    request.headers.get("x-correlation-id") ||
    crypto.randomUUID()
  );
}
