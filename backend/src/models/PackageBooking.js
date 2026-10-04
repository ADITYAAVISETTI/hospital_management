const mongoose = require('mongoose');

const STATUSES = ['requested', 'confirmed', 'completed', 'cancelled'];

// A patient's request for a health check-up package on a preferred date.
const packageBookingSchema = new mongoose.Schema(
  {
    bookingNo: { type: String, required: true, unique: true },
    package: { type: mongoose.Schema.Types.ObjectId, ref: 'HealthPackage', required: true },
    patient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    account: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: String, required: true }, // preferred date "YYYY-MM-DD"
    price: { type: Number, required: true },
    status: { type: String, enum: STATUSES, default: 'requested' },
    notes: { type: String, trim: true, default: '', maxlength: 500 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('PackageBooking', packageBookingSchema);
module.exports.STATUSES = STATUSES;
