import { NextResponse } from "next/server";
import { rejectSessionRequest } from "../../../../../lib/portal-store";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  try {
    const sessionRequest = await rejectSessionRequest(params.id);
    return NextResponse.json({ request: sessionRequest });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
