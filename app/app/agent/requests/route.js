import { NextResponse } from "next/server";
import { createAgentRequest } from "../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const created = await createAgentRequest(body);
    return NextResponse.json({ request: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
