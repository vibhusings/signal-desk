import { env } from 'cloudflare:workers';

export const PILOT_OWNER_ID = 'signal-desk-pilot';
const COOKIE_NAME = 'signal_desk_pilot';
const MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const pilotEnv = env as unknown as {
  PILOT_ACCESS_CODE_SHA256?: string;
  PILOT_SESSION_SECRET?: string;
};

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function digest(value: string) {
  return bytesToHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

async function signature(expires: string) {
  const secret = pilotEnv.PILOT_SESSION_SECRET;
  if (!secret || secret.length < 32) return '';
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return bytesToHex(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${PILOT_OWNER_ID}.${expires}`)));
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length || left.length > 256) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

function cookieValue(request: Request) {
  const header = request.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return rest.join('=');
  }
  return '';
}

export async function pilotSessionValid(request: Request) {
  const [version, expires, supplied] = cookieValue(request).split('.');
  if (version !== 'v1' || !/^\d{10,13}$/.test(expires) || Number(expires) <= Date.now()) return false;
  const expected = await signature(expires);
  return !!expected && constantTimeEqual(supplied ?? '', expected);
}

export function pilotModeConfigured() {
  const accessHash = pilotEnv.PILOT_ACCESS_CODE_SHA256;
  const sessionSecret = pilotEnv.PILOT_SESSION_SECRET;
  return !!accessHash && /^[a-f0-9]{64}$/i.test(accessHash) && !!sessionSecret && sessionSecret.length >= 32;
}

export async function workspaceOwner(request: Request) {
  if (pilotModeConfigured()) return await pilotSessionValid(request) ? PILOT_OWNER_ID : null;
  const platformOwner = request.headers.get('oai-authenticated-user-id');
  if (platformOwner) return platformOwner;
  return null;
}

export async function accessCodeValid(code: string) {
  const expected = pilotEnv.PILOT_ACCESS_CODE_SHA256;
  if (!expected || !/^[a-f0-9]{64}$/i.test(expected) || code.length < 8 || code.length > 128) return false;
  return constantTimeEqual(await digest(code), expected.toLowerCase());
}

export async function sessionCookie() {
  const expires = String(Date.now() + MAX_AGE_SECONDS * 1000);
  const signed = await signature(expires);
  if (!signed) throw new Error('Pilot access is not configured');
  return `${COOKIE_NAME}=v1.${expires}.${signed}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE_SECONDS}`;
}

export function clearSessionCookie() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}
