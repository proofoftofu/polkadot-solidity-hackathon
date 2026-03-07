import { NextResponse } from "next/server";
import { createSessionRequest, readPortalState } from "../../../lib/portal-store";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await readPortalState();
  return NextResponse.json({ requests: state.requests });
}

export async function POST(request) {
  try {
    const body = await request.json();
    const sessionRequest = await createSessionRequest(body);
    return NextResponse.json({ request: sessionRequest }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
