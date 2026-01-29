import type { APIRoute } from 'astro';
import { logout, getTokenFromCookie, createLogoutCookie } from '../../../lib/auth/session';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  const token = getTokenFromCookie(request.headers.get('cookie'));

  if (token) {
    await logout(token);
  }

  return new Response(null, {
    status: 302,
    headers: {
      'Location': '/admin/login',
      'Set-Cookie': createLogoutCookie()
    }
  });
};
