import { NextResponse } from "next/server";
import { listRequests } from "../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const ownerAddress = new URL(request.url).searchParams.get("ownerAddress") ?? undefined;
  const requests = await listRequests(ownerAddress);
  return NextResponse.json({ requests });
}
