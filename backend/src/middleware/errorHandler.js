const { HttpError } = require('../utils/httpError');

function notFoundHandler(req, res) {
  res.status(404).json({ message: 'API endpoint not found.' });
}

// Every error response is JSON: { message }.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ message: err.message });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body is not valid JSON.' });
  }
  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'Invalid id.' });
  }
  if (err.name === 'ValidationError') {
    const first = Object.values(err.errors)[0];
    return res.status(400).json({ message: first ? first.message : 'Invalid data.' });
  }
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'value';
    const messages = {
      email: 'An account with this email already exists.',
      name: 'That name is already in use.',
      slug: 'That name is already in use.',
      doctor: 'Sorry, that time slot was just booked. Please choose another.',
      date: 'There is already a holiday on that date.',
    };
    return res.status(409).json({ message: messages[field] || `Duplicate ${field}.` });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'The file is too large. Reports can be up to 5 MB and photos up to 2 MB.' });
  }
  const status = err.status || err.statusCode;
  if (status === 429) {
    return res.status(429).json({ message: 'Too many requests. Please try again later.' });
  }
  // Other client errors raised by Express itself (e.g. a missing static file).
  if (status >= 400 && status < 500) {
    return res.status(status).json({ message: status === 404 ? 'Not found.' : 'Bad request.' });
  }
  console.error(err);
  res.status(500).json({ message: 'Something went wrong on our side. Please try again.' });
}

module.exports = { notFoundHandler, errorHandler };
