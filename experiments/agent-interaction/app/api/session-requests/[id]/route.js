import { NextResponse } from "next/server";
import { readPortalState } from "../../../../lib/portal-store";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const state = await readPortalState();
  const item = state.requests.find((request) => request.id === params.id);

  if (!item) {
    return NextResponse.json({ error: "Session request not found" }, { status: 404 });
  }

  return NextResponse.json({ request: item });
}
