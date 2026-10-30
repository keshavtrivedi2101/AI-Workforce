import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from '../db/index.ts';
import { profiles } from '../db/schema.ts';
import { ensureUserWorkspace } from '../db/repository.ts';

const EPHEMERAL_FALLBACK_SECRET = crypto.randomBytes(32).toString('hex');

function getSigningSecret(): Buffer {
  const material = [
    process.env.SQL_PASSWORD || '',
    process.env.GEMINI_API_KEY || '',
    process.env.SQL_HOST || '',
    'ai-workforce-local-auth-v1',
  ]
    .filter(Boolean)
    .join(':');

  const seed = material.length > 30 ? material : `${material}:${EPHEMERAL_FALLBACK_SECRET}`;
  return crypto.createHash('sha256').update(seed).digest();
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') {
    return false;
  }
  const [, salt, expectedHex] = parts;
  if (!salt || !expectedHex) {
    return false;
  }
  const actualBuf = crypto.scryptSync(password, salt, 64);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(actualBuf, expectedBuf);
}

export interface LocalTokenClaims {
  uid: string;
  email: string;
  fullName: string;
  iat: number;
  exp: number;
}

export function mintLocalAuthToken(params: {
  uid: string;
  email: string;
  fullName: string;
}): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const claims: LocalTokenClaims = {
    uid: params.uid,
    email: params.email,
    fullName: params.fullName,
    iat: nowSec,
    exp: nowSec + 7 * 24 * 60 * 60, // 7 days
  };
  const encodedPayload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`awf.${encodedPayload}`)
    .digest('base64url');
  return `awf.${encodedPayload}.${signature}`;
}

export function verifyLocalAuthToken(token: string): LocalTokenClaims | null {
  if (!token || !token.startsWith('awf.')) {
    return null;
  }
  const segments = token.split('.');
  if (segments.length !== 3) {
    return null;
  }
  const [, encodedPayload, providedSig] = segments;
  if (!encodedPayload || !providedSig) {
    return null;
  }

  const expectedSig = crypto
    .createHmac('sha256', getSigningSecret())
    .update(`awf.${encodedPayload}`)
    .digest('base64url');

  const providedBuf = Buffer.from(providedSig, 'utf8');
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return null;
  }
  if (!crypto.timingSafeEqual(providedBuf, expectedBuf)) {
    return null;
  }

  try {
    const decoded = JSON.parse(
      Buffer.from(encodedPayload, 'base64url').toString('utf8')
    ) as LocalTokenClaims;
    const nowSec = Math.floor(Date.now() / 1000);
    if (!decoded.uid || !decoded.email || !decoded.exp || decoded.exp <= nowSec) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export async function registerLocalAccount(params: {
  fullName: string;
  email: string;
  password: string;
}) {
  const cleanEmail = params.email.trim().toLowerCase();
  const cleanName = params.fullName.trim();
  const localUid = `local:${cleanEmail}`;

  const existingLocal = await db
    .select()
    .from(profiles)
    .where(eq(profiles.uid, localUid))
    .limit(1);

  if (existingLocal.length > 0 && existingLocal[0].passwordHash) {
    throw new Error('An account with this email already exists. Please switch to Sign In.');
  }

  const passwordHash = hashPassword(params.password);

  await db
    .insert(profiles)
    .values({
      uid: localUid,
      email: cleanEmail,
      fullName: cleanName,
      passwordHash,
    })
    .onConflictDoUpdate({
      target: profiles.uid,
      set: {
        email: cleanEmail,
        fullName: cleanName,
        passwordHash,
        updatedAt: new Date(),
      },
    });

  const workspace = await ensureUserWorkspace({
    uid: localUid,
    email: cleanEmail,
    fullName: cleanName,
  });

  const token = mintLocalAuthToken({
    uid: workspace.profile.uid,
    email: workspace.profile.email,
    fullName: workspace.profile.fullName,
  });

  return {
    token,
    workspace: {
      profile: {
        id: workspace.profile.id,
        uid: workspace.profile.uid,
        email: workspace.profile.email,
        fullName: workspace.profile.fullName,
        avatarUrl: workspace.profile.avatarUrl,
      },
      business: workspace.business,
      membership: workspace.membership,
    },
  };
}

export async function loginLocalAccount(params: { email: string; password: string }) {
  const cleanEmail = params.email.trim().toLowerCase();
  const localUid = `local:${cleanEmail}`;

  const existingLocal = await db
    .select()
    .from(profiles)
    .where(eq(profiles.uid, localUid))
    .limit(1);

  if (existingLocal.length === 0 || !existingLocal[0].passwordHash) {
    const existingAny = await db
      .select()
      .from(profiles)
      .where(eq(profiles.email, cleanEmail))
      .limit(1);

    if (existingAny.length > 0) {
      throw new Error(
        'No password is set for this email yet. Switch to "Create Account" above to set an email password, or click "Continue with Google".'
      );
    }
    throw new Error('Invalid email address or password.');
  }

  const profile = existingLocal[0];
  const valid = verifyPassword(params.password, profile.passwordHash!);
  if (!valid) {
    throw new Error('Invalid email address or password.');
  }

  const workspace = await ensureUserWorkspace({
    uid: profile.uid,
    email: profile.email,
    fullName: profile.fullName,
    avatarUrl: profile.avatarUrl,
  });

  const token = mintLocalAuthToken({
    uid: workspace.profile.uid,
    email: workspace.profile.email,
    fullName: workspace.profile.fullName,
  });

  return {
    token,
    workspace: {
      profile: {
        id: workspace.profile.id,
        uid: workspace.profile.uid,
        email: workspace.profile.email,
        fullName: workspace.profile.fullName,
        avatarUrl: workspace.profile.avatarUrl,
      },
      business: workspace.business,
      membership: workspace.membership,
    },
  };
}
