const mongoose = require('mongoose');

const STATUSES = ['scheduled', 'completed', 'cancelled', 'no-show'];

const feedbackSchema = new mongoose.Schema(
  {
    rating: { type: Number, min: 1, max: 5, required: true },
    comment: { type: String, trim: true, default: '', maxlength: 1000 },
    createdAt: { type: Date, default: Date.now },
    // Admins can hide an inappropriate comment from the public profile.
    hidden: { type: Boolean, default: false },
  },
  { _id: false }
);

const appointmentSchema = new mongoose.Schema(
  {
    appointmentNo: { type: String, required: true, unique: true },
    // The person being seen (may be a family member).
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // The login that manages this appointment (the patient, or their guardian).
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
    bookedBy: { type: String, enum: ['patient', 'admin'], default: 'patient' },
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', required: true },
    date: { type: String, required: true }, // "YYYY-MM-DD"
    time: { type: String, required: true }, // "HH:MM"
    reason: { type: String, trim: true, default: '', maxlength: 500 },
    fee: { type: Number, default: 0 },
    status: { type: String, enum: STATUSES, default: 'scheduled' },
    // True while the appointment occupies its slot. Cancelling frees the slot.
    holdsSlot: { type: Boolean, default: true },
    rescheduleCount: { type: Number, default: 0 },
    cancelReason: { type: String, trim: true, default: '', maxlength: 300 },
    cancelledBy: { type: String, enum: ['patient', 'doctor', 'admin', ''], default: '' },
    // Filled in by the doctor after the consultation.
    diagnosis: { type: String, trim: true, default: '', maxlength: 2000 },
    prescription: { type: String, trim: true, default: '', maxlength: 4000 },
    doctorNotes: { type: String, trim: true, default: '', maxlength: 4000 },
    feedback: { type: feedbackSchema, default: undefined },
    reminderSentAt: { type: Date },
  },
  { timestamps: true }
);

// A doctor's slot can be held by only one appointment. This index is what
// actually prevents double booking, even when two requests arrive together.
appointmentSchema.index(
  { doctor: 1, date: 1, time: 1 },
  { unique: true, partialFilterExpression: { holdsSlot: true } }
);
appointmentSchema.index({ patient: 1, date: -1 });
appointmentSchema.index({ date: 1, status: 1 });

module.exports = mongoose.model('Appointment', appointmentSchema);
module.exports.STATUSES = STATUSES;
