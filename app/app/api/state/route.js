import { NextResponse } from "next/server";
import { getPortalSnapshot } from "../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getPortalSnapshot();
  return NextResponse.json(snapshot);
}
