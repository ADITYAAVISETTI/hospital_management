const config = require('./config');
const app = require('./app');
const { connectDb } = require('./db');
const mailer = require('./utils/mailer');
const { startReminderJob } = require('./services/notifications');

// Load every model before syncing indexes.
require('./models/User');
require('./models/Department');
require('./models/Doctor');
require('./models/Appointment');
require('./models/Enquiry');
require('./models/Holiday');
require('./models/Report');
require('./models/HealthPackage');
require('./models/PackageBooking');

async function main() {
  try {
    await connectDb();
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('\nCould not connect to MongoDB at', config.mongoUri);
    console.error('Make sure MongoDB is running (see README, "Common problems").\n');
    console.error(err.message);
    process.exit(1);
  }

  app.listen(config.port, () => {
    console.log(`CityCare Hospital is running at http://localhost:${config.port}`);
    console.log(`Hospital time zone: ${process.env.TZ}`);
    if (!mailer.isConfigured()) {
      console.log('Email: SMTP not configured, so emails are printed here instead of being sent (see README).');
    }
  });
  startReminderJob();
}

main();
