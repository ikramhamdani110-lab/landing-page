// Vercel serverless: /api/admin/users/:id — ADMIN-only role management (Task 9).
const api = require('../../../auth-user-api');

module.exports = (req, res) => api.adminUsers(req, res);
