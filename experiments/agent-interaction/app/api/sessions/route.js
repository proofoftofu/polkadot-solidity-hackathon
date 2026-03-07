import { NextResponse } from "next/server";
import { readPortalState } from "../../../lib/portal-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readPortalState();
  return NextResponse.json({ sessions: state.sessions });
}
