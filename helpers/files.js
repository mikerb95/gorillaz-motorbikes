'use strict';
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');

const saveJSON = (file, data) => {
  try { fs.writeFileSync(path.join(__dirname, '..', 'data', file), JSON.stringify(data, null, 2), 'utf8'); } catch { }
};

const writeCatalog = (obj) => {
  try {
    const file = path.join(__dirname, '..', 'data', 'catalog.js');
    fs.writeFileSync(file, 'module.exports = ' + JSON.stringify(obj, null, 2) + ' ;\n', 'utf8');
  } catch { }
};

const productStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '..', 'images', 'products');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e6) + ext);
  },
});

const uploadProduct = multer({
  storage: productStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|webp|avif)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  },
}).array('images', 5);

module.exports = { saveJSON, writeCatalog, uploadProduct };
