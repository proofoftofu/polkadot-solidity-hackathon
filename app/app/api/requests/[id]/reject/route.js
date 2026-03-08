import { NextResponse } from "next/server";
import { rejectRequest } from "../../../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function POST(_request, context) {
  try {
    const { id } = await context.params;
    const rejected = await rejectRequest(id);
    return NextResponse.json({ request: rejected });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
