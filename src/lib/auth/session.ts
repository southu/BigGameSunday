import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database, AdminUser, AdminSession } from '../../types/database';
import { verifyPassword } from './password';

const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

export interface AuthResult {
  success: boolean;
  error?: string;
  token?: string;
  admin?: Omit<AdminUser, 'password_hash'>;
}

function getSupabase(): SupabaseClient<Database> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.SUPABASE_SERVICE_ROLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase credentials');
  }

  return createClient<Database>(url, key);
}

function generateToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

async function hashToken(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(token);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function login(
  email: string,
  password: string,
  ipAddress?: string,
  userAgent?: string
): Promise<AuthResult> {
  const supabase = getSupabase();

  const { data: admin, error: fetchError } = await supabase
    .from('admin_users')
    .select('*')
    .eq('email', email.toLowerCase())
    .maybeSingle();

  if (fetchError || !admin) {
    return { success: false, error: 'Invalid email or password' };
  }

  if (admin.locked_until && new Date(admin.locked_until) > new Date()) {
    const remainingMs = new Date(admin.locked_until).getTime() - Date.now();
    const remainingMins = Math.ceil(remainingMs / 60000);
    return { success: false, error: `Account locked. Try again in ${remainingMins} minutes.` };
  }

  const validPassword = await verifyPassword(password, admin.password_hash);

  if (!validPassword) {
    const newAttempts = (admin.failed_login_attempts || 0) + 1;
    const updates: { failed_login_attempts: number; locked_until?: string } = {
      failed_login_attempts: newAttempts
    };

    if (newAttempts >= MAX_FAILED_ATTEMPTS) {
      updates.locked_until = new Date(Date.now() + LOCKOUT_DURATION_MS).toISOString();
    }

    await supabase
      .from('admin_users')
      .update(updates)
      .eq('id', admin.id);

    return { success: false, error: 'Invalid email or password' };
  }

  await supabase
    .from('admin_users')
    .update({
      failed_login_attempts: 0,
      locked_until: null,
      last_login: new Date().toISOString()
    })
    .eq('id', admin.id);

  const token = generateToken();
  const tokenHash = await hashToken(token);

  await supabase.from('admin_sessions').insert({
    admin_id: admin.id,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + SESSION_DURATION_MS).toISOString(),
    ip_address: ipAddress || null,
    user_agent: userAgent || null
  });

  const { password_hash: _, ...adminWithoutPassword } = admin;

  return {
    success: true,
    token,
    admin: adminWithoutPassword
  };
}

export async function validateSession(token: string): Promise<{ valid: boolean; admin?: Omit<AdminUser, 'password_hash'> }> {
  if (!token) {
    return { valid: false };
  }

  const supabase = getSupabase();
  const tokenHash = await hashToken(token);

  const { data: session, error: sessionError } = await supabase
    .from('admin_sessions')
    .select('*, admin_users(*)')
    .eq('token_hash', tokenHash)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle();

  if (sessionError || !session || !session.admin_users) {
    return { valid: false };
  }

  const admin = session.admin_users as AdminUser;
  const { password_hash: _, ...adminWithoutPassword } = admin;

  return {
    valid: true,
    admin: adminWithoutPassword
  };
}

export async function logout(token: string): Promise<void> {
  const supabase = getSupabase();
  const tokenHash = await hashToken(token);

  await supabase
    .from('admin_sessions')
    .delete()
    .eq('token_hash', tokenHash);
}

export async function cleanupExpiredSessions(): Promise<void> {
  const supabase = getSupabase();

  await supabase
    .from('admin_sessions')
    .delete()
    .lt('expires_at', new Date().toISOString());
}

export function getTokenFromCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;

  const cookies = cookieHeader.split(';').map(c => c.trim());
  for (const cookie of cookies) {
    const [name, value] = cookie.split('=');
    if (name === 'admin_token') {
      return value;
    }
  }
  return null;
}

export function createSessionCookie(token: string): string {
  const expires = new Date(Date.now() + SESSION_DURATION_MS).toUTCString();
  return `admin_token=${token}; Path=/admin; HttpOnly; Secure; SameSite=Strict; Expires=${expires}`;
}

export function createLogoutCookie(): string {
  return 'admin_token=; Path=/admin; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}
