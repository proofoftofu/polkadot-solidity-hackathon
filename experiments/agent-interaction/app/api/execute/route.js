import { NextResponse } from "next/server";
import { executeSessionCommand } from "../../../lib/portal-store";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const execution = await executeSessionCommand(body);
    return NextResponse.json({ execution });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
