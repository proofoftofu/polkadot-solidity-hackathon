import { NextResponse } from "next/server";
import { executeAgentRequest } from "../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const execution = await executeAgentRequest(body);
    return NextResponse.json({ execution }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
