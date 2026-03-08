import { NextResponse } from "next/server";
import { listExecutions } from "../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function GET() {
  const executions = await listExecutions();
  return NextResponse.json({ executions });
}
