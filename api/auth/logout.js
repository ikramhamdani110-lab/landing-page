// Vercel serverless: POST /api/auth/logout — stateless: client discards the token.
const api = require('../../auth-user-api');
module.exports = (req, res) => api.logout(req, res);
