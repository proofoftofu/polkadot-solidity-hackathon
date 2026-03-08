import { NextResponse } from "next/server";
import { rejectRequest } from "../../../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function POST(_request, { params }) {
  try {
    const rejected = await rejectRequest(params.id);
    return NextResponse.json({ request: rejected });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
