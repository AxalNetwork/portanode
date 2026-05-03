import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../env';

const ALG = 'HS256';

function key(env: Env): Uint8Array {
  return new TextEncoder().encode(env.JWT_SECRET);
}

export interface SessionClaims {
  sub: string;     // customer id
  email: string;
  jti: string;     // session id
  csrf: string;    // csrf token
}

export async function signSession(env: Env, claims: SessionClaims, ttlSec: number): Promise<string> {
  return await new SignJWT({ email: claims.email, csrf: claims.csrf })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setSubject(claims.sub)
    .setJti(claims.jti)
    .setIssuedAt()
    .setExpirationTime(`${ttlSec}s`)
    .sign(key(env));
}

export async function verifySession(env: Env, token: string): Promise<SessionClaims> {
  const { payload } = await jwtVerify(token, key(env), {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
    algorithms: [ALG],
  });
  return {
    sub: String(payload.sub),
    email: String(payload.email),
    jti: String(payload.jti),
    csrf: String(payload.csrf),
  };
}
