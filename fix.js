const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

// Fix GET /club/registro
code = code.replace(/app\.get\('\/club\/registro', \(req, res\) => \{\n  await user\.save\(\);\n  if/, "app.get('/club/registro', (req, res) => {\n  if");

// Fix POST /club/login
const oldLogin = "res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 });                                 await user.save();\n  res.redirect('/club/panel');";
const safeLogin = "res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 });\n  res.redirect('/club/panel');";
code = code.replace(oldLogin, safeLogin);

// Fix POST /club/registro
const oldReg = "res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 });                                 await user.save();\n  res.redirect('/club/panel');";
const safeReg = "res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 });\n  res.redirect('/club/panel');";
code = code.replace(oldReg, safeReg);

// Remove duplicate user.save() in app.get(/club/olvide) if any? Let's fix global "await user.save() before res.redirect" except where intended (visitas, vehiculos, etc).
// Actually, it's safer to just rewrite the login and register routes via regex:

code = code.replace(/app\.post\('\/club\/login', async \(req, res\) => \{[\s\S]*?\}\);/, `app.post('/club/login', async (req, res) => {
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
});`);

code = code.replace(/app\.post\('\/club\/registro', async \(req, res\) => \{[\s\S]*?\}\);/, `app.post('/club/registro', async (req, res) => {
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
});`);

fs.writeFileSync('app.js', code);
