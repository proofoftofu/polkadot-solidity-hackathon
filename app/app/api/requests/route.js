import { NextResponse } from "next/server";
import { listRequests } from "../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const requests = await listRequests();
  return NextResponse.json({ requests });
}
