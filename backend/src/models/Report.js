const mongoose = require('mongoose');

const CATEGORIES = ['lab', 'radiology', 'discharge-summary', 'prescription', 'other'];

// A medical report file (PDF or image) attached to a patient.
// The file itself is stored on disk in backend/uploads/reports/ (never public).
const reportSchema = new mongoose.Schema(
  {
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    category: { type: String, enum: CATEGORIES, default: 'lab' },
    reportDate: { type: String, required: true }, // "YYYY-MM-DD"
    notes: { type: String, trim: true, default: '', maxlength: 1000 },
    fileName: { type: String, required: true, maxlength: 200 },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    storedName: { type: String, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    uploadedByName: { type: String, default: '' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Report', reportSchema);
module.exports.CATEGORIES = CATEGORIES;
