// Vercel serverless: GET/PUT /api/user/profile — protected. GET returns the
// authenticated user's profile; PUT updates permitted fields (identity from token only).
const api = require('../../auth-user-api');
module.exports = (req, res) => api.profile(req, res);
