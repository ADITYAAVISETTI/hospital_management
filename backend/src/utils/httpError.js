class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const badRequest = (msg) => new HttpError(400, msg);
const unauthorized = (msg = 'Please log in to continue.') => new HttpError(401, msg);
const forbidden = (msg = 'You do not have permission to do this.') => new HttpError(403, msg);
const notFound = (msg = 'Not found.') => new HttpError(404, msg);
const conflict = (msg) => new HttpError(409, msg);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound, conflict };
