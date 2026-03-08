import { NextResponse } from "next/server";
import { approveRequest } from "../../../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function POST(request, context) {
  try {
    const body = await request.json().catch(() => ({}));
    const { id } = await context.params;
    console.log("[api/requests/approve] request", { id, ownerAddress: body?.ownerAddress });
    const session = await approveRequest(id, body?.ownerAddress);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
