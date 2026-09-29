import { accessCodeValid, clearSessionCookie, sessionCookie } from '@/lib/pilot-auth';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  if (!request.headers.get('content-type')?.includes('application/json')) {
    return Response.json({ error: 'Expected JSON' }, { status: 415 });
  }
  const raw = await request.text();
  if (raw.length > 512) return Response.json({ error: 'Request too large' }, { status: 413 });
  let code = '';
  try {
    code = String(JSON.parse(raw).code ?? '');
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }
  if (!await accessCodeValid(code)) {
    await new Promise(resolve => setTimeout(resolve, 350));
    return Response.json({ error: 'Invalid access code' }, { status: 401 });
  }
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': await sessionCookie(), 'Cache-Control': 'no-store' } },
  );
}

export async function DELETE(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return Response.json({ error: 'Invalid request origin' }, { status: 403 });
  }
  return Response.json(
    { ok: true },
    { headers: { 'Set-Cookie': clearSessionCookie(), 'Cache-Control': 'no-store' } },
  );
}
