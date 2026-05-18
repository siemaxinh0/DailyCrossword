// Vercel serverless entry. Wraps the Express app from ../server.js.
// READ_ONLY wymusza tryb bez zapis\u00f3w (filesystem jest read-only na Vercel).
process.env.READ_ONLY = '1';
module.exports = require('../server.js');
