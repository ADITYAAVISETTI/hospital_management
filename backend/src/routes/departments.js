const router = require('express').Router();
const Department = require('../models/Department');
const Doctor = require('../models/Doctor');
const { authenticate, optionalAuth, requireRole } = require('../middleware/auth');
const { validate, Joi, objectId } = require('../middleware/validate');
const { notFound, conflict, badRequest } = require('../utils/httpError');
const { publicDoctorQuery } = require('./doctors');

const slugify = (s) =>
  s
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const departmentSchema = Joi.object({
  name: Joi.string().trim().min(2).max(80).required(),
  summary: Joi.string().trim().min(5).max(200).required(),
  description: Joi.string().trim().max(3000).allow(''),
  icon: Joi.string().trim().pattern(/^ri-[a-z0-9-]+$/).allow(''),
  services: Joi.array().items(Joi.string().trim().min(1).max(100)).max(30),
  active: Joi.boolean(),
});

/** Adds doctorCount (active doctors) and, for admins, totalDoctorCount (incl. inactive). */
async function withDoctorCounts(departments, includeTotals = false) {
  const counts = await Doctor.aggregate([
    { $group: { _id: '$department', active: { $sum: { $cond: ['$active', 1, 0] } }, total: { $sum: 1 } } },
  ]);
  const byId = new Map(counts.map((c) => [String(c._id), c]));
  return departments.map((d) => {
    const c = byId.get(String(d._id));
    const out = { ...d, doctorCount: c ? c.active : 0 };
    if (includeTotals) out.totalDoctorCount = c ? c.total : 0;
    return out;
  });
}

/** Builds the stored fields from validated input; rejects names that make an empty slug. */
function departmentFields(body) {
  const slug = slugify(body.name);
  if (!slug) throw badRequest('Department name must contain letters or numbers.');
  const fields = { ...body, slug };
  if (!fields.icon) delete fields.icon; // fall back to the schema default
  return fields;
}

// Public list. Admins may pass ?all=true to include hidden departments.
router.get('/', optionalAuth, async (req, res) => {
  const isAdmin = req.user && req.user.role === 'admin';
  const showAll = isAdmin && req.query.all === 'true';
  const departments = await Department.find(showAll ? {} : { active: true }).sort({ name: 1 }).lean();
  res.json(await withDoctorCounts(departments, isAdmin));
});

router.get('/:slug', async (req, res) => {
  const department = await Department.findOne({ slug: req.params.slug, active: true }).lean();
  if (!department) throw notFound('Department not found.');
  const doctors = await publicDoctorQuery({ department: department._id });
  res.json({ ...department, doctors });
});

router.post('/', authenticate, requireRole('admin'), validate(departmentSchema), async (req, res) => {
  const department = await Department.create(departmentFields(req.body));
  res.status(201).json(department);
});

router.put(
  '/:id',
  authenticate,
  requireRole('admin'),
  validate(Joi.object({ id: objectId.required() }), 'params'),
  validate(departmentSchema),
  async (req, res) => {
    const department = await Department.findByIdAndUpdate(
      req.params.id,
      departmentFields(req.body),
      { new: true, runValidators: true }
    );
    if (!department) throw notFound('Department not found.');
    res.json(department);
  }
);

router.delete(
  '/:id',
  authenticate,
  requireRole('admin'),
  validate(Joi.object({ id: objectId.required() }), 'params'),
  async (req, res) => {
    const doctorCount = await Doctor.countDocuments({ department: req.params.id });
    if (doctorCount > 0) {
      throw conflict(
        `This department still has ${doctorCount} doctor(s). Move them to another department or mark the department inactive instead.`
      );
    }
    const department = await Department.findByIdAndDelete(req.params.id);
    if (!department) throw notFound('Department not found.');
    res.json({ message: 'Department deleted.' });
  }
);

module.exports = router;
