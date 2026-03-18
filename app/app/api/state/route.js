import { NextResponse } from "next/server";
import { getPortalSnapshot } from "../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const ownerAddress = new URL(request.url).searchParams.get("ownerAddress") ?? undefined;
  const snapshot = await getPortalSnapshot(ownerAddress);
  return NextResponse.json(snapshot);
}
