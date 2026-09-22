import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_EXPIRY = '15m';
const REFRESH_TOKEN_EXPIRY = '30d';
export const REFRESH_TOKEN_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function getSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set in the environment');
  }
  return secret;
}

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role, type: 'access' },
    getSecret(),
    { expiresIn: ACCESS_TOKEN_EXPIRY }
  );
}

export function signRefreshToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), type: 'refresh' },
    getSecret(),
    { expiresIn: REFRESH_TOKEN_EXPIRY }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, getSecret());
}

export function issueTokens(user) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: signRefreshToken(user),
  };
}

export function refreshCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    path: '/',
  };
}
