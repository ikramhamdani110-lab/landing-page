// Vercel serverless: POST /api/auth/register — creates a new TALORA user account.
const api = require('../../auth-user-api');
module.exports = (req, res) => api.register(req, res);
