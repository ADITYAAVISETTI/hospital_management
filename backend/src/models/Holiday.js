const mongoose = require('mongoose');

// A day the hospital OPD is closed (no appointments can be booked).
const holidaySchema = new mongoose.Schema(
  {
    date: { type: String, required: true, unique: true }, // "YYYY-MM-DD"
    name: { type: String, required: true, trim: true, maxlength: 80 },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Holiday', holidaySchema);
