// Vercel serverless: GET /api/user/profile — protected, returns the authenticated user's profile.
const api = require('../../auth-user-api');
module.exports = (req, res) => api.profile(req, res);
