import type { Request, Response, NextFunction } from 'express';
import { createClient } from '@supabase/supabase-js';
import { adminAuth } from '../lib/firebase-admin.ts';
import { ensureUserWorkspace } from '../db/repository.ts';
import { verifyLocalAuthToken } from '../server/localAuth.ts';

export interface WorkspaceAuthContext {
  profile: {
    id: string;
    uid: string;
    email: string;
    fullName: string;
    avatarUrl: string | null;
  };
  business: {
    id: string;
    name: string;
    industry: string;
    website: string | null;
    valueProposition: string;
    senderName: string;
    senderRole: string;
    qualificationCriteria: {
      targetIndustries: string[];
      minBudgetUsd: number;
      minCompanySize: number;
      fitThresholdScore: number;
      autoDraftMinScore: number;
      maxWorkflowRetries: number;
      idealCustomerNotes: string;
      toneOfVoice: string;
    };
  };
  membership: {
    id: string;
    businessId: string;
    profileId: string;
    role: string;
  };
}

export interface AuthRequest extends Request {
  authContext?: WorkspaceAuthContext;
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const serverSupabase =
  supabaseUrl &&
  supabaseAnonKey &&
  !supabaseUrl.includes('your-project-ref') &&
  !supabaseAnonKey.includes('YOUR_SUPABASE_ANON_KEY')
    ? createClient(supabaseUrl, supabaseAnonKey)
    : null;

export const requireAuth = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authentication required. Please sign in to access your workspace.',
    });
  }

  const token = authHeader.slice('Bearer '.length).trim();
  if (!token) {
    return res.status(401).json({ error: 'Authentication token is missing.' });
  }

  try {
    let uid = '';
    let email = '';
    let fullName: string | null = null;
    let avatarUrl: string | null = null;

    const authProviderHeader = req.headers['x-auth-provider'];

    if (authProviderHeader === 'local' || token.startsWith('awf.')) {
      const localClaims = verifyLocalAuthToken(token);
      if (!localClaims) {
        return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
      }
      uid = localClaims.uid;
      email = localClaims.email;
      fullName = localClaims.fullName;
    } else if (authProviderHeader === 'supabase' && serverSupabase) {
      const { data, error } = await serverSupabase.auth.getUser(token);
      if (error || !data.user) {
        return res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
      }
      uid = `sb:${data.user.id}`;
      email = data.user.email || `${data.user.id}@workspace.local`;
      fullName =
        (data.user.user_metadata?.full_name as string | undefined) ||
        (data.user.user_metadata?.name as string | undefined) ||
        null;
    } else {
      const decoded = await adminAuth.verifyIdToken(token);
      uid = decoded.uid;
      email = decoded.email || `${decoded.uid}@workspace.local`;
      fullName = decoded.name || null;
      avatarUrl = decoded.picture || null;
    }

    const workspace = await ensureUserWorkspace({
      uid,
      email,
      fullName,
      avatarUrl,
    });

    req.authContext = {
      profile: {
        id: workspace.profile.id,
        uid: workspace.profile.uid,
        email: workspace.profile.email,
        fullName: workspace.profile.fullName,
        avatarUrl: workspace.profile.avatarUrl,
      },
      business: {
        id: workspace.business.id,
        name: workspace.business.name,
        industry: workspace.business.industry,
        website: workspace.business.website,
        valueProposition: workspace.business.valueProposition,
        senderName: workspace.business.senderName,
        senderRole: workspace.business.senderRole,
        qualificationCriteria: workspace.business.qualificationCriteria,
      },
      membership: {
        id: workspace.membership.id,
        businessId: workspace.membership.businessId,
        profileId: workspace.membership.profileId,
        role: workspace.membership.role,
      },
    };

    next();
  } catch (error) {
    console.error('Authentication verification failed:', error);
    return res.status(401).json({
      error: 'Session expired or unauthorized. Please sign in again.',
    });
  }
};

// Sliding-window server-side rate limiter to protect API & AI endpoints
interface RateBucket {
  timestamps: number[];
}

const buckets = new Map<string, RateBucket>();

export function createRateLimiter(options: { windowMs: number; maxRequests: number; label: string }) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    const actorKey =
      req.authContext?.profile.uid || req.ip || req.headers['x-forwarded-for']?.toString() || 'anon';
    const key = `${options.label}:${actorKey}`;
    const now = Date.now();
    const cutoff = now - options.windowMs;

    const bucket = buckets.get(key) || { timestamps: [] };
    bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);

    if (bucket.timestamps.length >= options.maxRequests) {
      return res.status(429).json({
        error: `Rate limit exceeded for ${options.label}. Please wait a moment before making additional requests.`,
      });
    }

    bucket.timestamps.push(now);
    buckets.set(key, bucket);
    next();
  };
}
