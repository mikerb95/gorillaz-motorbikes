const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

// 1. Add imports
code = code.replace("const crypto = require('crypto');", "const crypto = require('crypto');\nconst User = require('./models/User');\nconst bcrypt = require('bcryptjs');");

// 2. Remove users array
code = code.replace(/\/\/ Demo users \(in-memory\)\s+const users = \[[ \S\s]*?\];\s+/, '');

// 3. Update locals middleware
const oldLocals = `app.use((req, res, next) => {
  res.locals.user = users.find(u => u.id === req.userId); // userId instead of session.userId
  const c = req.session.cart || { items: {}, count: 0, subtotal: 0 };`;

const newLocals = `app.use(async (req, res, next) => {
  if (req.userId) {
    try {
      res.locals.user = await User.findById(req.userId).lean();
    } catch(e) { res.locals.user = null; }
  } else {
    res.locals.user = null;
  }
  const c = req.session.cart || { items: {}, count: 0, subtotal: 0 };`;

code = code.replace(oldLocals, newLocals);

// 4. Update requireAdmin
code = code.replace(/const u = users\.find\(u => u\.id === req\.userId\);/, 'const u = res.locals.user;');

// 5. Fix admin stats
code = code.replace(/app\.get\('\/admin', requireAuth, requireAdmin, \(req, res\) => {/, "app.get('/admin', requireAuth, requireAdmin, async (req, res) => {\n  const usersCount = await User.countDocuments();");
code = code.replace(/users: users\.length,/, "users: usersCount,");

// 6. Fix admin users list
code = code.replace(/app\.get\('\/admin\/usuarios', requireAuth, requireAdmin, \(req, res\) => {/, "app.get('/admin/usuarios', requireAuth, requireAdmin, async (req, res) => {\n  const usersList = await User.find().lean();");
code = code.replace(/res\.render\('admin\/users', \{ users \} \);/, "res.render('admin/users', { users: usersList });");
code = code.replace(/const u = users\.find\(u => u\.id === id\);/, "const u = await User.findById(id);");
code = code.replace(/const i = users\.findIndex\(u => u\.id === id\);\n\s*if \(i !== -1\) users\.splice\(i, 1\);/, "await User.findByIdAndDelete(id);");
code = code.replace(/app\.post\('\/admin\/usuarios\/eliminar', requireAuth, requireAdmin, \(req, res\) => {/, "app.post('/admin/usuarios/eliminar', requireAuth, requireAdmin, async (req, res) => {");

// 7. Update Auth Routes
const oldLogin = `app.post('/club/login', (req, res) => {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email && u.password === password);
  if (!user) return res.status(401).render('club/login', { error: 'Credenciales inválidas' });
  req.session.userId = user.id;
  res.redirect('/club/panel');
});`;

const newLogin = `app.post('/club/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).render('club/login', { error: 'Credenciales inválidas' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).render('club/login', { error: 'Credenciales inválidas' });
    const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET || 'gorillaz-ultra-secret', { expiresIn: '7d' });
    res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 });
    res.redirect('/club/panel');
  } catch(e) {
    res.status(500).render('club/login', { error: 'Error del servidor' });
  }
});`;

code = code.replace(oldLogin, newLogin);

const oldRegister = `app.post('/club/registro', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).render('club/register');
  const exists = users.find(u => u.email === email);
  if (exists) return res.status(400).render('club/register');
  const newUser = {
    id: uuidv4(), name, email, password,
    membership: { level: 'Básica', since: new Date().toISOString().slice(0, 10), expires: null, benefits: ['Acceso al club'] },
    visits: []
  };
  users.push(newUser);
  req.session.userId = newUser.id;
  res.redirect('/club/panel');
});`;

const newRegister = `app.post('/club/registro', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).render('club/register');
  try {
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).render('club/register', { error: 'El correo ya está en uso' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = new User({
      name, email, password: hashedPassword,
      membership: { level: 'Básica', since: new Date().toISOString().slice(0, 10), expires: null, benefits: ['Acceso premium próximamente'] },
    });
    await newUser.save();
    const token = jwt.sign({ id: newUser._id }, process.env.JWT_SECRET || 'gorillaz-ultra-secret', { expiresIn: '7d' });
    res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 });
    res.redirect('/club/panel');
  } catch(e) {
    res.status(500).render('club/register', { error: 'Error del servidor' });
  }
});`;

code = code.replace(oldRegister, newRegister);

// 8. Logout
code = code.replace(/app\.post\('\/club\/logout', \(req, res\) => \{\n  req\.session\.destroy\(\(\) => \{\n    res\.redirect\('\/'\);\n  \}\);\n\}\);/, "app.post('/club/logout', (req, res) => {\n  res.clearCookie('jwt');\n  res.redirect('/');\n});");

fs.writeFileSync('app.js', code);
console.log('Refactoring complete!');
