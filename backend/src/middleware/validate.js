const Joi = require('joi');
const mongoose = require('mongoose');
const { badRequest } = require('../utils/httpError');

/**
 * Validates req[source] against a Joi schema and replaces it with the
 * cleaned value (trimmed strings, defaults applied, unknown keys removed).
 */
function validate(schema, source = 'body') {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[source] ?? {}, {
      abortEarly: true,
      stripUnknown: true,
      convert: true,
    });
    if (error) throw badRequest(error.details[0].message.replace(/"/g, ''));
    if (source === 'query') {
      // req.query is a getter in Express 5, so store the result separately.
      req.validQuery = value;
    } else {
      req[source] = value;
    }
    next();
  };
}

// Shared building blocks.
const objectId = Joi.string()
  .custom((v, helpers) => (mongoose.isValidObjectId(v) ? v : helpers.error('any.invalid')))
  .messages({ 'any.invalid': '{{#label}} is not a valid id' });
const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(120);
const phone = Joi.string().trim().pattern(/^[+\d][\d\s-]{6,18}$/).messages({
  'string.pattern.base': 'phone must be a valid phone number',
});
const date = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/).messages({
  'string.pattern.base': '{{#label}} must be in YYYY-MM-DD format',
});
const time = Joi.string().pattern(/^([01]\d|2[0-3]):[0-5]\d$/).messages({
  'string.pattern.base': '{{#label}} must be in HH:MM format',
});
const password = Joi.string()
  .min(8)
  .max(64)
  .pattern(/[A-Za-z]/)
  .pattern(/\d/)
  .messages({
    'string.min': 'password must be at least 8 characters',
    'string.pattern.base': 'password must contain at least one letter and one number',
  });

module.exports = { validate, Joi, objectId, email, phone, date, time, password };
