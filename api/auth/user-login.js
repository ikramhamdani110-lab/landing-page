// Vercel serverless: POST /api/auth/user-login — authenticates a TALORA user.
const api = require('../../auth-user-api');
module.exports = (req, res) => api.login(req, res);
