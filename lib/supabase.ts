// ============================================================
// RevenueGuard AI — Supabase Client
// ============================================================
// WHY TWO CLIENTS:
//
// 1. `supabase` (browser client) — uses the ANON key
//    - Safe to use in client components (React components in the browser)
//    - Respects Row Level Security (RLS) policies
//    - Can only read/write what RLS allows
//
// 2. `supabaseAdmin` (server client) — uses the SERVICE ROLE key
//    - ONLY used in API routes (server-side code)
//    - Bypasses RLS — can read/write everything
//    - NEVER expose this in client code
//
// PANEL Q: "Why do you have two Supabase clients?"
// ANSWER:  "The browser client uses the anon key and respects RLS.
//           The server client uses the service role key to bypass RLS
//           for backend operations like batch processing. The service
//           role key never leaves the server."
// ============================================================

import { createClient } from '@supabase/supabase-js';

// These are prefixed with NEXT_PUBLIC_ so Next.js exposes them to the browser.
// The anon key is safe to expose — it only has the permissions RLS allows.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Browser client — for React components
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Server client — for API routes only
// Uses the service role key which bypasses Row Level Security.
// This is safe because API routes run on the server, never in the browser.
export function getSupabaseAdmin() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is not set. ' +
      'This function can only be called from server-side code (API routes).'
    );
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
