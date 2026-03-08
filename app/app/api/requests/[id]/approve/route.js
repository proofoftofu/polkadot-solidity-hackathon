import { NextResponse } from "next/server";
import { approveRequest } from "../../../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function POST(request, { params }) {
  try {
    const body = await request.json().catch(() => ({}));
    const session = await approveRequest(params.id, body?.ownerAddress);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
