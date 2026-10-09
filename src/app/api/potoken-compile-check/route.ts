// TEMPORARY dev-only compile check for the optional browser poToken provider.
// Forces Turbopack to build potoken-browser.ts (with playwright-core absent +
// serverExternalPackages). Deleted immediately after verification.
import { NextResponse } from "next/server";
import { browserPoTokenEnabled } from "@/lib/veil/quasar/potoken-browser";

export async function GET() {
  return NextResponse.json({ browserPoTokenEnabled: browserPoTokenEnabled() });
}
