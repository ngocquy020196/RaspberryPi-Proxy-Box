/**
 * Authentication middleware & routes
 * Simple secret key login with session-based auth
 */

const SECRET_KEY = process.env.SECRET_KEY || 'changeme123';

/**
 * Login handler — compare against SECRET_KEY in .env
 */
function login(req, res) {
  const { password } = req.body;

  if (!password) {
    return res.status(400).json({ success: false, error: 'Password is required' });
  }

  if (password === SECRET_KEY) {
    req.session.authenticated = true;
    req.session.loginTime = Date.now();
    return res.json({ success: true, message: 'Login successful' });
  }

  return res.status(401).json({ success: false, error: 'Invalid password' });
}

/**
 * Logout handler
 */
function logout(req, res) {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout failed' });
    }
    res.json({ success: true, message: 'Logged out' });
  });
}

/**
 * Check auth status
 */
function check(req, res) {
  if (req.session && req.session.authenticated) {
    return res.json({ authenticated: true });
  }
  return res.json({ authenticated: false });
}

/**
 * Middleware to protect routes
 */
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.status(401).json({ success: false, error: 'Authentication required' });
}

module.exports = { login, logout, check, requireAuth };
