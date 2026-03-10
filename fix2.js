const fs = require('fs');
let code = fs.readFileSync('app.js', 'utf8');

// I might have duplicated the handler or inserted wrong text in updating `if (u) {`, let me just correctly build that logic:

const errRegex = /app\.post\('\/admin\/usuarios\/actualizar'[\s\S]*?res\.redirect\('\/admin\/usuarios'\);\n\}\);/;
code = code.replace(errRegex, `app.post('/admin/usuarios/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { id, name, membershipLevel } = req.body;
  const u = await User.findById(id);
  if (u) {
    if (name) u.name = name;
    if (membershipLevel) {
       if (!u.membership) u.membership = {};
       u.membership.level = membershipLevel;
    }
    await u.save();
  }
  res.redirect('/admin/usuarios');
});`);

fs.writeFileSync('app.js', code);
