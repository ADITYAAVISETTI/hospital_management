/**
 * Fills the database with departments, doctors and demo accounts.
 *
 *   npm run seed          add anything that is missing (safe to run again)
 *   npm run seed:reset    DELETE all hospital data first, then seed
 */
const mongoose = require('mongoose');
const config = require('../src/config');
const { connectDb } = require('../src/db');
const User = require('../src/models/User');
const Department = require('../src/models/Department');
const Doctor = require('../src/models/Doctor');
const Appointment = require('../src/models/Appointment');
const Enquiry = require('../src/models/Enquiry');
const { Counter } = require('../src/models/Counter');
const Holiday = require('../src/models/Holiday');
const HealthPackage = require('../src/models/HealthPackage');
const PackageBooking = require('../src/models/PackageBooking');
const Report = require('../src/models/Report');
const { todayString } = require('../src/utils/time');

const ADMIN = {
  name: 'Hospital Administrator',
  email: process.env.ADMIN_EMAIL || 'admin@citycare.test',
  password: process.env.ADMIN_PASSWORD || 'Admin@1234',
};
const DOCTOR_PASSWORD = 'Doctor@1234';
const PATIENT = {
  name: 'Demo Patient',
  email: 'patient@citycare.test',
  password: 'Patient@1234',
  phone: '+91 98765 43210',
  gender: 'female',
  dateOfBirth: '1992-04-18',
  bloodGroup: 'B+',
  address: '12 Lake View Road, Hyderabad',
};

const departments = [
  {
    name: 'Cardiology',
    icon: 'ri-heart-pulse-line',
    summary: 'Complete heart care, from prevention and diagnosis to interventional procedures.',
    description:
      'Our Cardiology department treats conditions of the heart and blood vessels, including coronary artery disease, heart failure, arrhythmias and hypertension. A 24x7 cardiac emergency team and a fully equipped cath lab support every patient.',
    services: ['ECG & Echocardiography', 'Treadmill (stress) test', 'Holter monitoring', 'Angiography & Angioplasty', 'Pacemaker implantation', 'Heart failure clinic'],
  },
  {
    name: 'Neurology',
    icon: 'ri-brain-line',
    summary: 'Diagnosis and treatment of disorders of the brain, spine and nerves.',
    description:
      'The Neurology team manages stroke, epilepsy, migraine, Parkinson’s disease, multiple sclerosis and nerve disorders, with rapid stroke response and advanced neuro-imaging.',
    services: ['Stroke care', 'EEG & EMG / nerve conduction', 'Epilepsy clinic', 'Headache & migraine clinic', 'Movement disorders'],
  },
  {
    name: 'Orthopaedics',
    icon: 'ri-walk-line',
    summary: 'Bone, joint and sports-injury care, including joint replacement.',
    description:
      'From fractures and sports injuries to arthritis and spine problems, our orthopaedic surgeons offer both non-surgical care and advanced procedures such as knee and hip replacement and arthroscopy.',
    services: ['Joint replacement', 'Arthroscopy', 'Fracture & trauma care', 'Sports medicine', 'Spine care', 'Physiotherapy'],
  },
  {
    name: 'Paediatrics',
    icon: 'ri-parent-line',
    summary: 'Friendly, expert care for newborns, children and teenagers.',
    description:
      'Our paediatricians look after children from birth through adolescence: routine check-ups, vaccinations, growth monitoring and treatment of childhood illnesses, backed by a Level III NICU.',
    services: ['Well-baby clinic', 'Vaccinations', 'Newborn care & NICU', 'Growth & development', 'Childhood asthma & allergy'],
  },
  {
    name: 'Obstetrics & Gynaecology',
    icon: 'ri-women-line',
    summary: 'Pregnancy, childbirth and complete women’s health care.',
    description:
      'We support women through every stage of life: antenatal care, normal and high-risk deliveries, fertility guidance, menopause care and minimally invasive gynaecological surgery.',
    services: ['Antenatal care', 'Normal & C-section delivery', 'High-risk pregnancy', 'Fertility consultation', 'Laparoscopic surgery'],
  },
  {
    name: 'General Medicine',
    icon: 'ri-stethoscope-line',
    summary: 'First point of care for fever, infections, diabetes, BP and more.',
    description:
      'Our physicians diagnose and treat a wide range of adult illnesses and long-term conditions such as diabetes, high blood pressure and thyroid disorders, and coordinate referrals to specialists.',
    services: ['Fever & infections', 'Diabetes care', 'Hypertension', 'Thyroid disorders', 'Preventive health check-ups'],
  },
  {
    name: 'Dermatology',
    icon: 'ri-user-heart-line',
    summary: 'Skin, hair and nail care, medical and cosmetic.',
    description:
      'Treatment for acne, eczema, psoriasis, infections, hair loss and pigmentation, along with safe cosmetic procedures performed by qualified dermatologists.',
    services: ['Acne & scar treatment', 'Psoriasis & eczema', 'Hair loss clinic', 'Skin allergy testing', 'Laser procedures'],
  },
  {
    name: 'Ophthalmology',
    icon: 'ri-eye-line',
    summary: 'Eye examinations, cataract surgery and vision care.',
    description:
      'Complete eye care including vision testing, cataract and glaucoma management, diabetic retinopathy screening and paediatric eye care.',
    services: ['Comprehensive eye exam', 'Cataract surgery', 'Glaucoma clinic', 'Retina clinic', 'Paediatric ophthalmology'],
  },
];

const packages = [
  {
    name: 'Basic Health Check',
    summary: 'Essential screening for adults under 40 with no known conditions.',
    price: 1499,
    originalPrice: 2200,
    recommendedFor: 'Adults 18–40',
    preparation: '10–12 hours fasting. Water is allowed.',
    tests: ['Complete blood count', 'Fasting blood sugar', 'Lipid profile', 'Liver function test', 'Kidney function test', 'Urine routine', 'Physician consultation'],
  },
  {
    name: 'Executive Health Check',
    summary: 'Comprehensive annual check-up for busy professionals.',
    price: 3999,
    originalPrice: 5600,
    recommendedFor: 'Adults 30+',
    preparation: '10–12 hours fasting. Bring any current medicines.',
    tests: ['Everything in Basic Health Check', 'HbA1c', 'Thyroid profile (T3, T4, TSH)', 'Vitamin D & B12', 'ECG', 'Chest X-ray', 'Ultrasound abdomen', 'Dietitian consultation'],
  },
  {
    name: 'Cardiac Care Check',
    summary: 'Detailed heart screening for people with risk factors.',
    price: 5499,
    originalPrice: 7500,
    recommendedFor: 'Diabetes, high BP, smokers or family history',
    preparation: '10–12 hours fasting. Wear comfortable shoes for the treadmill test.',
    tests: ['Lipid profile', 'HbA1c', 'hs-CRP', 'ECG', '2D Echocardiogram', 'Treadmill (stress) test', 'Cardiologist consultation'],
  },
  {
    name: 'Women’s Wellness Check',
    summary: 'Screening tailored to women’s health at every age.',
    price: 3499,
    originalPrice: 4800,
    recommendedFor: 'Women 25+',
    preparation: '10–12 hours fasting. Avoid booking during your period for the Pap smear.',
    tests: ['Complete blood count', 'Thyroid profile', 'Vitamin D', 'Iron studies', 'Pap smear', 'Ultrasound pelvis', 'Breast examination', 'Gynaecologist consultation'],
  },
];

// Upcoming OPD holidays (edit to suit your hospital).
const holidays = [
  { date: '2026-10-02', name: 'Gandhi Jayanti' },
  { date: '2026-12-25', name: 'Christmas' },
  { date: '2027-01-26', name: 'Republic Day' },
];

// Weekly schedules. Day 0 = Sunday.
const weekdaysMorning = [1, 2, 3, 4, 5, 6].map((day) => ({ day, start: '09:00', end: '13:00' }));
const weekdaysEvening = [1, 2, 3, 4, 5].map((day) => ({ day, start: '16:00', end: '19:00' }));
const alternateDays = [1, 3, 5].map((day) => ({ day, start: '10:00', end: '14:00' }));
const tueThuSat = [2, 4, 6].map((day) => ({ day, start: '10:00', end: '13:00' }));

const doctors = [
  ['Cardiology', 'Dr. Arjun Mehta', 'male', 'Interventional Cardiologist', 'MBBS, MD (Medicine), DM (Cardiology)', 18, 1000, weekdaysMorning, ['English', 'Hindi']],
  ['Cardiology', 'Dr. Kavya Iyer', 'female', 'Clinical Cardiologist', 'MBBS, MD, DNB (Cardiology)', 11, 900, weekdaysEvening, ['English', 'Tamil', 'Hindi']],
  ['Neurology', 'Dr. Rohan Kapoor', 'male', 'Neurologist', 'MBBS, MD, DM (Neurology)', 15, 1000, alternateDays, ['English', 'Hindi', 'Punjabi']],
  ['Neurology', 'Dr. Sneha Reddy', 'female', 'Epilepsy & Headache Specialist', 'MBBS, DNB (Neurology)', 9, 900, tueThuSat, ['English', 'Telugu']],
  ['Orthopaedics', 'Dr. Vikram Singh', 'male', 'Joint Replacement Surgeon', 'MBBS, MS (Ortho), Fellowship in Arthroplasty', 20, 900, weekdaysMorning, ['English', 'Hindi']],
  ['Orthopaedics', 'Dr. Ananya Das', 'female', 'Sports Medicine & Arthroscopy', 'MBBS, MS (Ortho)', 8, 800, weekdaysEvening, ['English', 'Bengali', 'Hindi']],
  ['Paediatrics', 'Dr. Meera Nair', 'female', 'Senior Paediatrician', 'MBBS, MD (Paediatrics)', 16, 700, weekdaysMorning, ['English', 'Malayalam', 'Hindi']],
  ['Paediatrics', 'Dr. Farhan Ali', 'male', 'Neonatologist', 'MBBS, DCH, DNB (Paediatrics)', 10, 700, weekdaysEvening, ['English', 'Urdu', 'Hindi']],
  ['Obstetrics & Gynaecology', 'Dr. Priya Sharma', 'female', 'Obstetrician & Gynaecologist', 'MBBS, MS (OBG)', 17, 800, weekdaysMorning, ['English', 'Hindi']],
  ['Obstetrics & Gynaecology', 'Dr. Lakshmi Rao', 'female', 'High-risk Pregnancy Specialist', 'MBBS, DGO, DNB (OBG)', 12, 900, alternateDays, ['English', 'Telugu', 'Kannada']],
  ['General Medicine', 'Dr. Sanjay Gupta', 'male', 'Consultant Physician', 'MBBS, MD (General Medicine)', 22, 600, weekdaysMorning, ['English', 'Hindi']],
  ['General Medicine', 'Dr. Neha Joshi', 'female', 'Diabetologist & Physician', 'MBBS, MD, Fellowship in Diabetology', 9, 600, weekdaysEvening, ['English', 'Marathi', 'Hindi']],
  ['Dermatology', 'Dr. Aisha Khan', 'female', 'Consultant Dermatologist', 'MBBS, MD (Dermatology)', 10, 700, tueThuSat, ['English', 'Hindi', 'Urdu']],
  ['Ophthalmology', 'Dr. Karthik Raman', 'male', 'Cataract & Retina Surgeon', 'MBBS, MS (Ophthalmology), FICO', 14, 700, alternateDays, ['English', 'Tamil']],
];

const slugify = (s) => s.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const emailFor = (name) =>
  `${name.replace(/^Dr\.\s*/, '').toLowerCase().replace(/[^a-z]+/g, '.').replace(/^\.|\.$/g, '')}@citycare.test`;

async function ensureUser(data) {
  const existing = await User.findOne({ email: data.email });
  if (existing) return { user: existing, created: false };
  return { user: await User.create(data), created: true };
}

/** Live site: the admin must come from ADMIN_EMAIL / ADMIN_PASSWORD and be strong. */
function checkProductionAdmin() {
  const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  const problems = [];
  if (!ADMIN_EMAIL || /citycare\.test$/i.test(ADMIN_EMAIL)) problems.push('set ADMIN_EMAIL to your real admin email');
  if (!ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12 || !/[A-Za-z]/.test(ADMIN_PASSWORD) || !/\d/.test(ADMIN_PASSWORD) || ADMIN_PASSWORD === 'Admin@1234') {
    problems.push('set ADMIN_PASSWORD to a strong password (12+ characters, letters and numbers)');
  }
  if (problems.length) {
    console.error(`Cannot set up the live site: ${problems.join('; ')}.`);
    process.exit(1);
  }
}

async function main() {
  const reset = process.argv.includes('--reset');
  const production = process.argv.includes('--production');
  if (production) checkProductionAdmin();
  if (reset && (production || config.env === 'production')) {
    console.error('Refusing to delete data on the live site. (--reset is for development only.)');
    process.exit(1);
  }
  await connectDb();
  console.log(`Connected to ${config.mongoUri.replace(/\/\/[^@]*@/, '//***@')}`);

  if (reset) {
    await Promise.all([User, Department, Doctor, Appointment, Enquiry, Counter, Holiday, HealthPackage, PackageBooking, Report].map((m) => m.deleteMany({})));
    console.log('Deleted existing hospital data.');
  }

  const deptIds = {};
  for (const d of departments) {
    const slug = slugify(d.name);
    const dept = await Department.findOneAndUpdate(
      { slug },
      { $setOnInsert: { ...d, slug } },
      { new: true, upsert: true }
    );
    deptIds[d.name] = dept._id;
  }
  console.log(`Departments: ${departments.length}`);

  let createdDoctors = 0;
  // The live site gets no demo doctors: add your real doctors in Admin → Doctors.
  for (const [dept, name, gender, specialization, qualifications, experienceYears, consultationFee, schedule, languages] of production ? [] : doctors) {
    const { user } = await ensureUser({
      name,
      gender,
      email: emailFor(name),
      password: DOCTOR_PASSWORD,
      role: 'doctor',
      phone: '+91 40 4000 1000',
    });
    if (!(await Doctor.exists({ user: user._id }))) {
      await Doctor.create({
        user: user._id,
        department: deptIds[dept],
        specialization,
        qualifications,
        experienceYears,
        consultationFee,
        languages,
        schedule,
        slotMinutes: 15,
        bio: `${name} (${qualifications}) has ${experienceYears} years of experience as a ${specialization.toLowerCase()}, and is known for clear explanations, evidence-based treatment and involving patients and families in every decision.`,
      });
      createdDoctors += 1;
    }
  }
  console.log(production ? 'Doctors: none (add your real doctors in Admin → Doctors)' : `Doctors: ${doctors.length} (${createdDoctors} new)`);

  for (const p of packages) {
    await HealthPackage.updateOne({ slug: slugify(p.name) }, { $setOnInsert: { ...p, slug: slugify(p.name) } }, { upsert: true });
  }
  console.log(`Health packages: ${packages.length}`);
  const today = todayString(); // hospital-local date
  for (const h of holidays.filter((x) => x.date >= today)) {
    await Holiday.updateOne({ date: h.date }, { $setOnInsert: h }, { upsert: true });
  }
  console.log('Holidays: added upcoming public holidays');

  const admin = await ensureUser({ ...ADMIN, role: 'admin' });
  if (production) {
    console.log(`\nAdmin account ${admin.created ? 'created' : 'already exists'}: ${ADMIN.email}`);
    console.log('Log in at /login.html. Departments, packages and holidays are starter content you can edit in the admin dashboard.');
    return;
  }
  await ensureUser({ ...PATIENT, role: 'patient' });

  console.log('\nDemo logins (change these before real use):');
  console.log(`  Admin   : ${ADMIN.email} / ${ADMIN.password}`);
  console.log(`  Doctor  : ${emailFor(doctors[0][1])} / ${DOCTOR_PASSWORD}   (every doctor uses this password)`);
  console.log(`  Patient : ${PATIENT.email} / ${PATIENT.password}`);
}

main()
  .catch((err) => {
    console.error('Seeding failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
