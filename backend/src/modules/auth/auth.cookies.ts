import type { CookieOptions, Response } from "express";
import type { Env } from "../../config/env.js";
import { authCookieName, type AuthClient } from "./auth-client.js";

function baseCookieOptions(env: Env): CookieOptions {
  return {
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAME_SITE,
    domain: env.COOKIE_DOMAIN,
  };
}

export function setAuthCookies(
  res: Response,
  refreshToken: string,
  csrfToken: string,
  env: Env,
  client?: AuthClient,
): void {
  const maxAge = env.REFRESH_TOKEN_TTL_DAYS * 86_400_000;
  res.cookie(authCookieName(env.REFRESH_COOKIE_NAME, client), refreshToken, {
    ...baseCookieOptions(env),
    httpOnly: true,
    path: `${env.API_PREFIX}/auth`,
    maxAge,
  });
  res.cookie(authCookieName(env.CSRF_COOKIE_NAME, client), csrfToken, {
    ...baseCookieOptions(env),
    httpOnly: false,
    path: "/",
    maxAge,
  });
}

export function clearAuthCookies(res: Response, env: Env, client?: AuthClient): void {
  res.clearCookie(authCookieName(env.REFRESH_COOKIE_NAME, client), {
    ...baseCookieOptions(env),
    httpOnly: true,
    path: `${env.API_PREFIX}/auth`,
  });
  res.clearCookie(authCookieName(env.CSRF_COOKIE_NAME, client), {
    ...baseCookieOptions(env),
    httpOnly: false,
    path: "/",
  });
}
