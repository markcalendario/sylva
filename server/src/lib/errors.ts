export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public detail?: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export class GitError extends Error {
  constructor(
    message: string,
    public exitCode: number,
    public stderr: string,
    public args: string[],
  ) {
    super(message);
    this.name = "GitError";
  }
}

export function notFound(what: string): HttpError {
  return new HttpError(404, `${what} not found`);
}

export function badRequest(message: string, detail?: string): HttpError {
  return new HttpError(400, message, detail);
}

export function conflict(message: string, detail?: string): HttpError {
  return new HttpError(409, message, detail);
}
