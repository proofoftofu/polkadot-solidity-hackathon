import { NextResponse } from "next/server";
import {
  executeAgentRequestWithOptions,
  getRequestById,
  getSessionRecord
} from "../../../lib/domain.js";
import {
  buildBootstrapSigningRequest,
  buildBootstrapUserOp,
  buildSessionSigningRequest,
  buildSessionUserOp,
  sendUserOperation
} from "../../../lib/bundler.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    console.log("[agent/executions] request", {
      requestId: body.requestId,
      sessionId: body.sessionId,
      live: body.live === true,
      prepare: body.prepare,
      submit: body.submit,
      hasOwnerSignature: Boolean(body.ownerSignature),
      hasSessionSignature: Boolean(body.sessionSignature)
    });
    let execution;
    if (body.live === true) {
      const approvedRequest = await getRequestById(body.requestId);
      const session = await getSessionRecord(body.sessionId);

      if (body.prepare === "bootstrap") {
        const prepared = await buildBootstrapSigningRequest(body.sessionId);
        return NextResponse.json({
          prepared,
          request: approvedRequest,
          session
        });
      }

      if (body.prepare === "session") {
        const prepared = await buildSessionSigningRequest(body.sessionId);
        return NextResponse.json({
          prepared,
          request: approvedRequest,
          session
        });
      }

      if (body.submit === "bootstrap") {
        const prepared = await buildBootstrapUserOp(body.sessionId, body.ownerSignature);
        const submission = await sendUserOperation(prepared);
        return NextResponse.json({
          submission,
          request: approvedRequest,
          session: await getSessionRecord(body.sessionId)
        });
      }

      if (body.submit === "session") {
        const prepared = await buildSessionUserOp(body.sessionId, body.sessionSignature, body.signerAddress);
        const submission = await sendUserOperation(prepared);
        execution = await executeAgentRequestWithOptions({
          requestId: body.requestId,
          sessionId: body.sessionId,
          statusOverride: "submitted",
          resultOverride: {
            mode: "live-userop",
            userOpHash: submission.userOpHash,
            txHash: submission.txHash,
            receipt: submission.receipt
          }
        });
        execution.hubTxHash = submission.txHash;
        execution.userOpHash = submission.userOpHash;
      } else {
        throw new Error("For live execution, set prepare or submit to bootstrap or session");
      }
    } else {
      execution = await executeAgentRequestWithOptions(body);
    }
    return NextResponse.json({ execution }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
