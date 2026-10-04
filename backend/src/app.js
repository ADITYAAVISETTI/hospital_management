const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');

const app = express();

app.disable('x-powered-by');
if (config.trustProxy) app.set('trust proxy', config.trustProxy);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://cdn.jsdelivr.net'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com', 'https://cdn.jsdelivr.net', 'data:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        // Google Maps embed on the contact page.
        frameSrc: ['https://www.google.com', 'https://maps.google.com'],
      },
    },
  })
);
app.use(cors());

// File uploads (base64 in JSON) need a bigger body limit than everything else.
app.use('/api/reports', express.json({ limit: '8mb' }));
app.use(/^\/api\/doctors\/[^/]+\/photo$/, express.json({ limit: '4mb' }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/departments', require('./routes/departments'));
app.use('/api/doctors', require('./routes/doctors'));
app.use('/api/appointments', require('./routes/appointments'));
app.use('/api/family', require('./routes/family'));
app.use('/api/holidays', require('./routes/holidays'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/packages', require('./routes/packages'));
app.use('/api/enquiries', require('./routes/enquiries'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api', notFoundHandler);

// Doctor photos are public. (Medical reports are NOT served statically.)
app.use('/uploads/doctors', express.static(path.join(config.uploadsDir, 'doctors'), { maxAge: '7d', fallthrough: false }));

// The website itself (frontend/ folder). /doctors serves doctors.html, etc.
app.use(express.static(config.frontendDir, { extensions: ['html'] }));
app.use((req, res) => res.status(404).sendFile('404.html', { root: config.frontendDir }));

app.use(errorHandler);

module.exports = app;
