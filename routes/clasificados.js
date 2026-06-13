'use strict';
const express   = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth }            = require('../middleware/auth');
const { uploadClassified, deleteFromBlob } = require('../helpers/files');
const { setFlash } = require('../helpers/flash');
const {
  createClassified, updateClassified, setClassifiedStatus, getClassifiedById,
  getActiveClassifieds, getClassifiedsByUser, deleteClassified,
} = require('../db');

const router = express.Router();

// Catálogo de categorías de clasificados. El slug se guarda en la BD; el nombre
// y el ícono se usan en las vistas. Mantener en sync con la validación de abajo.
const CATEGORIES = [
  { slug: 'moto',      name: 'Motocicletas', icon: '🏍️' },
  { slug: 'parte',     name: 'Partes',       icon: '⚙️'  },
  { slug: 'accesorio', name: 'Accesorios',   icon: '🧰'  },
];
const CATEGORY_SLUGS  = CATEGORIES.map(c => c.slug);
const CONDITIONS      = ['nuevo', 'usado'];
const MAX_IMAGES      = 6;

// Evita spam de publicaciones aunque el miembro esté autenticado.
const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Has alcanzado el límite de publicaciones por hora. Inténtalo más tarde.',
});

// Normaliza y valida los campos del formulario. Devuelve { data } o { error }.
function parseForm(body) {
  const title       = (body.title       || '').toString().trim();
  const description = (body.description  || '').toString().trim();
  const category    = (body.category    || '').toString().trim();
  const condition   = (body.condition   || '').toString().trim();
  const brand       = (body.brand       || '').toString().trim();
  const city        = (body.city        || '').toString().trim();
  const department  = (body.department  || '').toString().trim();
  const contactPhone = (body.contactPhone || '').toString().trim();
  const negotiable  = body.negotiable === 'on' || body.negotiable === '1' || body.negotiable === 'true';
  const price       = parseInt((body.price || '0').toString().replace(/[^\d]/g, ''), 10) || 0;

  if (title.length < 4 || title.length > 80)
    return { error: 'El título debe tener entre 4 y 80 caracteres.' };
  if (!CATEGORY_SLUGS.includes(category))
    return { error: 'Selecciona una categoría válida.' };
  if (!CONDITIONS.includes(condition))
    return { error: 'Selecciona el estado del artículo.' };
  if (description.length > 2000)
    return { error: 'La descripción es demasiado larga (máx. 2000 caracteres).' };
  if (price < 0 || price > 9_999_999_999)
    return { error: 'El precio no es válido.' };
  if (brand.length > 60)
    return { error: 'La marca es demasiado larga.' };
  if (contactPhone && !/^[+\d\s\-()]{7,25}$/.test(contactPhone))
    return { error: 'El teléfono de contacto no es válido.' };

  return {
    data: { title, description, category, condition, brand, city, department, contactPhone, negotiable, price },
  };
}

function catName(slug) {
  return (CATEGORIES.find(c => c.slug === slug) || {}).name || slug;
}

// ── Público ─────────────────────────────────────────────────────────────────

router.get('/', async (req, res, next) => {
  try {
    const cat  = CATEGORY_SLUGS.includes((req.query.cat || '').toString()) ? req.query.cat.toString() : '';
    const q    = (req.query.q || '').toString().trim();
    const city = (req.query.city || '').toString().trim();
    const listings = await getActiveClassifieds({ category: cat || undefined, q: q || undefined, city: city || undefined });
    const categories = CATEGORIES.map(c => ({ ...c }));
    const cities = [...new Set(listings.map(l => l.city).filter(Boolean))].sort();
    res.render('clasificados/index', {
      title: 'Clasificados del Club',
      listings, categories, selectedCat: cat, q, city, cities, catName,
    });
  } catch (e) { next(e); }
});

// ── Miembro: gestión de sus anuncios (antes de /:id para no chocar) ──────────

router.get('/nuevo', requireAuth, (req, res) => {
  res.render('clasificados/form', {
    title: 'Publicar anuncio',
    categories: CATEGORIES, conditions: CONDITIONS,
    listing: null, error: null, mode: 'create',
  });
});

router.post('/nuevo', requireAuth, createLimiter, uploadClassified, async (req, res, next) => {
  try {
    const parsed = parseForm(req.body);
    const images = (req.blobUrls || []).slice(0, MAX_IMAGES);
    if (parsed.error) {
      // Limpia las imágenes ya subidas si la validación falla.
      await Promise.all(images.map(deleteFromBlob));
      return res.status(400).render('clasificados/form', {
        title: 'Publicar anuncio', categories: CATEGORIES, conditions: CONDITIONS,
        listing: { ...req.body }, error: parsed.error, mode: 'create',
      });
    }
    const user = res.locals.user;
    await createClassified({
      ...parsed.data,
      userId: req.userId,
      sellerName: user ? (user.nickname || user.name) : '',
      contactPhone: parsed.data.contactPhone || (user && user.phone) || '',
      images,
      status: 'pending',
    });
    setFlash(res, 'success', 'Tu anuncio fue enviado y aparecerá publicado una vez que el equipo lo apruebe.');
    res.redirect('/clasificados/mios');
  } catch (e) { next(e); }
});

router.get('/mios', requireAuth, async (req, res, next) => {
  try {
    const listings = await getClassifiedsByUser(req.userId);
    res.render('clasificados/mis-anuncios', { title: 'Mis anuncios', listings, catName });
  } catch (e) { next(e); }
});

router.get('/:id/editar', requireAuth, async (req, res, next) => {
  try {
    const listing = await getClassifiedById(req.params.id);
    if (!listing || listing.userId !== req.userId) return res.redirect('/clasificados/mios');
    res.render('clasificados/form', {
      title: 'Editar anuncio', categories: CATEGORIES, conditions: CONDITIONS,
      listing, error: null, mode: 'edit',
    });
  } catch (e) { next(e); }
});

router.post('/:id/editar', requireAuth, uploadClassified, async (req, res, next) => {
  try {
    const listing = await getClassifiedById(req.params.id);
    if (!listing || listing.userId !== req.userId) return res.redirect('/clasificados/mios');

    const parsed   = parseForm(req.body);
    const newImages = req.blobUrls || [];
    // Imágenes existentes que el usuario decidió conservar (checkboxes/hidden).
    const keep = [].concat(req.body.keepImages || []).filter(Boolean);
    const keptImages = listing.images.filter(url => keep.includes(url));
    const removedImages = listing.images.filter(url => !keep.includes(url));

    if (parsed.error) {
      await Promise.all(newImages.map(deleteFromBlob));
      return res.status(400).render('clasificados/form', {
        title: 'Editar anuncio', categories: CATEGORIES, conditions: CONDITIONS,
        listing: { ...listing, ...req.body }, error: parsed.error, mode: 'edit',
      });
    }

    const images = [...keptImages, ...newImages].slice(0, MAX_IMAGES);
    // Editar contenido reabre la moderación: vuelve a 'pending' salvo que esté vendido.
    const status = listing.status === 'sold' ? 'sold' : 'pending';
    await updateClassified(listing.id, { ...parsed.data, images, status, rejectReason: null });
    await Promise.all(removedImages.map(deleteFromBlob));

    setFlash(res, 'success', 'Anuncio actualizado. Volverá a publicarse tras una nueva revisión.');
    res.redirect('/clasificados/mios');
  } catch (e) { next(e); }
});

router.post('/:id/vendido', requireAuth, async (req, res, next) => {
  try {
    const listing = await getClassifiedById(req.params.id);
    if (!listing || listing.userId !== req.userId) return res.redirect('/clasificados/mios');
    await setClassifiedStatus(listing.id, 'sold', null);
    setFlash(res, 'success', '¡Felicidades por la venta! Marcamos el anuncio como vendido.');
    res.redirect('/clasificados/mios');
  } catch (e) { next(e); }
});

router.post('/:id/reactivar', requireAuth, async (req, res, next) => {
  try {
    const listing = await getClassifiedById(req.params.id);
    if (!listing || listing.userId !== req.userId) return res.redirect('/clasificados/mios');
    await setClassifiedStatus(listing.id, 'pending', null);
    setFlash(res, 'success', 'Anuncio reenviado a revisión.');
    res.redirect('/clasificados/mios');
  } catch (e) { next(e); }
});

router.post('/:id/eliminar', requireAuth, async (req, res, next) => {
  try {
    const listing = await getClassifiedById(req.params.id);
    if (!listing || listing.userId !== req.userId) return res.redirect('/clasificados/mios');
    await deleteClassified(listing.id);
    await Promise.all((listing.images || []).map(deleteFromBlob));
    setFlash(res, 'success', 'Anuncio eliminado.');
    res.redirect('/clasificados/mios');
  } catch (e) { next(e); }
});

// ── Público: detalle (al final, ruta comodín) ────────────────────────────────

router.get('/:id', async (req, res, next) => {
  try {
    const listing = await getClassifiedById(req.params.id);
    if (!listing) return res.status(404).render('404');
    // Solo los anuncios aprobados son públicos; el dueño y los admin pueden ver
    // los suyos en cualquier estado (para previsualizar antes de la aprobación).
    const u = res.locals.user;
    const isOwner = u && listing.userId === req.userId;
    const isAdmin = u && u.role === 'admin';
    if (listing.status !== 'active' && !isOwner && !isAdmin) return res.status(404).render('404');
    const related = (await getActiveClassifieds({ category: listing.category }))
      .filter(l => l.id !== listing.id).slice(0, 4);
    res.render('clasificados/detail', { title: listing.title, listing, related, catName });
  } catch (e) { next(e); }
});

module.exports = router;
