// Uploads arrive as base64 in JSON. The real type is checked from the file's
// first bytes (not the name the browser sent), so a renamed script can't sneak in.
const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { badRequest } = require('./httpError');

const SIGNATURES = [
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
];

/**
 * Decodes a base64 upload (optionally a data: URL) and checks its type and size.
 * Returns { buffer, mime, ext }.
 */
function decodeUpload(data, { allowed, maxBytes }) {
  const base64 = String(data || '').replace(/^data:[^;]+;base64,/, '');
  if (!base64 || !/^[A-Za-z0-9+/=\s]+$/.test(base64)) throw badRequest('The file could not be read.');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length === 0) throw badRequest('The file is empty.');
  if (buffer.length > maxBytes) throw badRequest(`The file is too large (max ${Math.round(maxBytes / 1024 / 1024)} MB).`);
  const kind = SIGNATURES.find((s) => allowed.includes(s.mime) && s.test(buffer));
  if (!kind) {
    const names = allowed.map((m) => m.split('/')[1].toUpperCase().replace('JPEG', 'JPG')).join(', ');
    throw badRequest(`Unsupported file type. Please upload ${names}.`);
  }
  return { buffer, mime: kind.mime, ext: kind.ext };
}

function uploadPath(folder, name = '') {
  return path.join(config.uploadsDir, folder, name);
}

async function saveUpload(folder, name, buffer) {
  await fs.mkdir(uploadPath(folder), { recursive: true });
  await fs.writeFile(uploadPath(folder, name), buffer);
}

async function removeUpload(folder, name) {
  if (!name) return;
  await fs.rm(uploadPath(folder, path.basename(name)), { force: true });
}

const randomName = (ext) => `${crypto.randomBytes(16).toString('hex')}.${ext}`;

module.exports = { decodeUpload, saveUpload, removeUpload, uploadPath, randomName };
