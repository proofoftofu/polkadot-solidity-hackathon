import { NextResponse } from "next/server";
import { createAgentRequest } from "../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    console.log("[agent/requests] create", {
      actionType: body.actionType,
      targetChain: body.targetChain,
      ownerAddress: body.ownerAddress,
      sessionPublicKey: body.sessionPublicKey
    });
    const created = await createAgentRequest(body);
    return NextResponse.json({ request: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
