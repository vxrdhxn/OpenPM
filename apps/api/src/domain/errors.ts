/**
 * Errors the service layer throws for outcomes the client caused or may see: not found, not allowed,
 * a bad or conflicting request. Each carries its HTTP status, so the central error handler
 * (plugins/errors.ts) answers `{ error: message }` with that status; no route has to catch and map
 * them. The message is shown to the client, so it never contains SQL, ids of other tenants or secrets.
 *
 * Anything else that is thrown is a bug or an outage and becomes a logged 500 (or 503).
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 400: the request is malformed in a way the JSON Schema could not express. */
export class BadRequestError extends AppError {
  constructor(message: string) {
    super(400, message);
  }
}

/** 403: the caller is known and may see the resource, but may not do this to it. */
export class ForbiddenError extends AppError {
  constructor(message: string) {
    super(403, message);
  }
}

/**
 * 404: no such resource in the caller's organization, or one they may not see. The two are
 * deliberately indistinguishable, so ids from other tenants or private projects leak nothing.
 */
export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super(404, message);
  }
}

/** 409: the request conflicts with the current state (a duplicate, a stale update). */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message);
  }
}
