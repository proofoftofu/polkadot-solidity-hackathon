import { NextResponse } from "next/server";
import { listSessions } from "../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const ownerAddress = new URL(request.url).searchParams.get("ownerAddress") ?? undefined;
  const sessions = await listSessions(ownerAddress);
  return NextResponse.json({ sessions });
}
