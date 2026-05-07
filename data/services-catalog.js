'use strict';
// Source of truth is services-catalog.json — this file just re-exports it
// so existing require('./data/services-catalog') calls keep working.
module.exports = require('./services-catalog.json');
