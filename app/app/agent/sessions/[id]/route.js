import { NextResponse } from "next/server";
import { getSessionById } from "../../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  try {
    const session = await getSessionById(params.id);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
}
