import { NextResponse } from "next/server";

import { buildBootstrapUserOp, buildSessionUserOp, sendUserOperation } from "../../../../lib/bundler.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();

    let prepared;
    if (body.kind === "bootstrap") {
      prepared = await buildBootstrapUserOp(body.sessionId);
    } else if (body.kind === "session") {
      prepared = await buildSessionUserOp(body.sessionId);
    } else if (body.userOp) {
      prepared = body;
    } else {
      throw new Error("Provide either { kind: 'bootstrap'|'session', sessionId } or a raw userOp");
    }

    if (body.executionId) {
      prepared.executionId = body.executionId;
    }

    const result = await sendUserOperation(prepared);
    return NextResponse.json({ submission: result });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
