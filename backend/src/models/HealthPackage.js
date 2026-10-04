const mongoose = require('mongoose');

const healthPackageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true, trim: true, maxlength: 80 },
    slug: { type: String, required: true, unique: true },
    summary: { type: String, required: true, trim: true, maxlength: 200 },
    tests: { type: [String], default: [] },
    price: { type: Number, required: true, min: 0 },
    // Optional "was" price to show a discount.
    originalPrice: { type: Number, min: 0 },
    recommendedFor: { type: String, trim: true, default: '', maxlength: 120 },
    preparation: { type: String, trim: true, default: '', maxlength: 500 },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('HealthPackage', healthPackageSchema);
