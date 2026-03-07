import { NextResponse } from "next/server";
import { approveSessionRequest } from "../../../../../lib/portal-store";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  try {
    const session = await approveSessionRequest(params.id);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
