// middleware.js
//
// Routing Middleware runs before Vercel's normal static-file routing,
// so it reliably serves the marketing landing page on the bare tailiq.app
// domain while leaving every other host (the app on vector-fleet.vercel.app,
// app.tailiq.app, etc.) completely untouched.
//
// A vercel.json "has: host" rewrite was tried first but is unreliable when
// the project already has its own root index.html — this is the documented
// fix for that case.

import { rewrite } from '@vercel/functions';

// Only run this middleware for requests to the root path — everything else
// (the app, /api/*, /share/*) is left alone entirely.
export const config = { matcher: '/' };

export default function middleware(request) {
  const host = request.headers.get('host') || '';

  if (host === 'tailiq.app' || host === 'www.tailiq.app') {
    return rewrite(new URL('/tailiq_landing.html', request.url));
  }

  // Any other host (vector-fleet.vercel.app, app.tailiq.app, preview URLs)
  // — returning nothing here lets the request continue to normal routing,
  // so the actual app's index.html keeps loading as before.
}
