const mongoose = require('mongoose');

// One weekly consultation window, e.g. Monday 09:00–13:00.
const scheduleSchema = new mongoose.Schema(
  {
    day: { type: Number, min: 0, max: 6, required: true }, // 0 = Sunday
    start: { type: String, required: true }, // "HH:MM"
    end: { type: String, required: true },
  },
  { _id: false }
);

// A period when the doctor is away (inclusive dates, "YYYY-MM-DD").
const leaveSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, required: true },
  reason: { type: String, trim: true, default: '', maxlength: 120 },
});

const doctorSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    specialization: { type: String, required: true, trim: true, maxlength: 120 },
    qualifications: { type: String, trim: true, default: '', maxlength: 200 },
    experienceYears: { type: Number, min: 0, max: 70, default: 0 },
    consultationFee: { type: Number, min: 0, default: 500 },
    bio: { type: String, trim: true, default: '', maxlength: 2000 },
    languages: { type: [String], default: ['English'] },
    schedule: { type: [scheduleSchema], default: [] },
    leaves: { type: [leaveSchema], default: [] },
    slotMinutes: { type: Number, enum: [10, 15, 20, 30], default: 15 },
    // Public URL of the profile photo, e.g. "/uploads/doctors/<id>.jpg".
    photo: { type: String, default: '' },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

doctorSchema.index({ department: 1, active: 1 });

module.exports = mongoose.model('Doctor', doctorSchema);
