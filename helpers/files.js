'use strict';
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const { put, del } = require('@vercel/blob');

const saveJSON = (file, data) => {
  try { fs.writeFileSync(path.join(__dirname, '..', 'data', file), JSON.stringify(data, null, 2), 'utf8'); } catch { }
};

const writeCatalog = (obj) => {
  try {
    const file = path.join(__dirname, '..', 'data', 'catalog.js');
    fs.writeFileSync(file, 'module.exports = ' + JSON.stringify(obj, null, 2) + ' ;\n', 'utf8');
  } catch { }
};

// Files stay in memory — no disk writes needed
const _multerMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|webp|avif)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  },
}).array('images', 5);

const PROXY_PREFIX = '/img-proxy?u=';

async function uploadToBlob(buffer, originalName, mimetype) {
  const ext      = path.extname(originalName).toLowerCase();
  const filename = `products/${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
  const blob     = await put(filename, buffer, { access: 'private', contentType: mimetype });
  // Store as a proxy URL so the server generates signed URLs on demand
  return PROXY_PREFIX + encodeURIComponent(blob.url);
}

function blobUrlFromProxy(proxyUrl) {
  if (!proxyUrl || !proxyUrl.startsWith(PROXY_PREFIX)) return null;
  return decodeURIComponent(proxyUrl.slice(PROXY_PREFIX.length));
}

async function deleteFromBlob(url) {
  // Skip legacy local URLs (old products uploaded before this migration)
  if (!url || url.startsWith('/images/')) return;
  const realUrl = blobUrlFromProxy(url) || url;
  try { await del(realUrl); } catch { }
}

async function signBlobUrl(proxyUrl) {
  const realUrl = blobUrlFromProxy(proxyUrl);
  if (!realUrl) return null;
  return getDownloadUrl(realUrl, { expiresIn: 3600 });
}

// Drop-in middleware: parses multipart form, uploads files to Blob,
// then sets req.blobUrls with the resulting public URLs.
const uploadProduct = (req, res, next) => {
  _multerMemory(req, res, async (err) => {
    if (err) return next(err);
    try {
      req.blobUrls = await Promise.all(
        (req.files || []).map(f => uploadToBlob(f.buffer, f.originalname, f.mimetype))
      );
      next();
    } catch (e) {
      next(e);
    }
  });
};

module.exports = { saveJSON, writeCatalog, uploadProduct, uploadToBlob, deleteFromBlob, signBlobUrl, blobUrlFromProxy };
