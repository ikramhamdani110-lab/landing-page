// Vercel serverless: /api/admin/users
//   GET /api/admin/users      — list accounts + roles (ADMIN only)
//   PUT /api/admin/users/:id  — change an account's role (ADMIN only)
// Task 9 (RBAC). 401 when unauthenticated, 403 for an authenticated EMPLOYEE.
// The acting principal comes from the bearer token only; the role is never read
// from the request body, so a user can never assign ADMIN to themselves.
const api = require('../../../auth-user-api');

module.exports = (req, res) => api.adminUsers(req, res);
