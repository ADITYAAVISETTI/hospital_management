const mongoose = require('mongoose');
const config = require('./config');

async function connectDb(uri = config.mongoUri) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  // Build indexes now (including the one that prevents double booking).
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
}

module.exports = { connectDb };
