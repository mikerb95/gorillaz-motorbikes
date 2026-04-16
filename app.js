'use strict';
require('dotenv').config();
const express      = require('express');
const cookieParser = require('cookie-parser');
const path         = require('path');

const { initDb }                    = require('./db');
const { JWT_SECRET }                = require('./config');
const { csrfToken, validateCsrf }   = require('./middleware/csrf');
const { jwtCart, templateLocals }   = require('./middleware/locals');

const app = express();

initDb().catch(err => console.error('❌ DB init error:', err));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser(process.env.COOKIE_SECRET || JWT_SECRET));
app.use(csrfToken);
app.use(jwtCart);
app.use('/static',   express.static(path.join(__dirname, 'public')));
app.use('/favicons', express.static(path.join(__dirname, 'favicons')));
app.use('/images',   express.static(path.join(__dirname, 'images')));
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');
app.use(templateLocals);
app.use(validateCsrf);

app.use('/',       require('./routes/home'));
app.use('/',       require('./routes/services'));
app.use('/',       require('./routes/shop'));
app.use('/',       require('./routes/courses'));
app.use('/',       require('./routes/events'));
app.use('/',       require('./routes/newsletter'));
app.use('/',       require('./routes/jobs'));
app.use('/',       require('./routes/static'));
app.use('/',       require('./routes/classes'));
app.use('/club',   require('./routes/club'));
app.use('/admin',  require('./routes/admin'));

app.use((req, res) => res.status(404).render('404'));

module.exports = app;
