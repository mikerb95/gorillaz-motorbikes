'use strict';

function setFlash(res, type, message) {
  res.cookie('_flash', JSON.stringify({ type, message }), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 60000,
  });
}

function readFlash(req, res) {
  const raw = req.cookies._flash;
  if (!raw) return null;
  res.clearCookie('_flash');
  try { return JSON.parse(raw); } catch { return null; }
}

module.exports = { setFlash, readFlash };
