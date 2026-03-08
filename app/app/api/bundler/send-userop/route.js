import { NextResponse } from "next/server";

import {
  buildBootstrapUserOp,
  buildBootstrapSigningRequest,
  buildSessionSigningRequest,
  buildSessionUserOp,
  sendUserOperation
} from "../../../../lib/bundler.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    console.log("[api/bundler/send-userop] request", {
      kind: body.kind,
      sessionId: body.sessionId,
      prepareOnly: body.prepareOnly === true,
      hasUserOp: Boolean(body.userOp),
      hasSignature: Boolean(body.signature),
      hasOwnerSignature: Boolean(body.ownerSignature),
      hasSessionSignature: Boolean(body.sessionSignature)
    });

    if (body.prepareOnly === true) {
      if (body.kind === "bootstrap") {
        const prepared = await buildBootstrapSigningRequest(body.sessionId);
        return NextResponse.json({ prepared });
      }
      if (body.kind === "session") {
        const prepared = await buildSessionSigningRequest(body.sessionId);
        return NextResponse.json({ prepared });
      }
      throw new Error("prepareOnly requires kind to be bootstrap or session");
    }

    let prepared;
    if (body.kind === "bootstrap") {
      prepared = await buildBootstrapUserOp(body.sessionId, body.ownerSignature ?? body.signature);
    } else if (body.kind === "session") {
      prepared = await buildSessionUserOp(
        body.sessionId,
        body.sessionSignature ?? body.signature,
        body.signerAddress
      );
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
