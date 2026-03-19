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
    const startedAt = Date.now();
    const body = await request.json();
    const ownerAddress = body.ownerAddress ?? body.signerAddress ?? body.requestOwnerAddress ?? null;
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
      console.log("[agent/executions] live-flow:start", {
        ownerAddress,
        requestId: body.requestId,
        sessionId: body.sessionId,
        prepare: body.prepare,
        submit: body.submit
      });
      const session = await getSessionRecord(body.sessionId, { ownerAddress });
      let approvedRequest = null;
      if (body.requestId) {
        try {
          approvedRequest = await getRequestById(body.requestId, ownerAddress);
        } catch (error) {
          if (body.prepare || body.submit) {
            console.log("[agent/executions] live-flow:request-missing", {
              ownerAddress,
              requestId: body.requestId,
              sessionId: body.sessionId,
              error: error.message
            });
          } else {
            throw error;
          }
        }
      }

      if (body.prepare === "bootstrap") {
        console.log("[agent/executions] live-flow:prepare-bootstrap:start", {
          ownerAddress,
          requestId: body.requestId,
          sessionId: body.sessionId
        });
        const prepared = await buildBootstrapSigningRequest(body.sessionId, ownerAddress);
        console.log("[agent/executions] live-flow:prepare-bootstrap:done", {
          elapsedMs: Date.now() - startedAt,
          requestId: body.requestId,
          sessionId: body.sessionId
        });
        return NextResponse.json({
          prepared,
          request: approvedRequest,
          session
        });
      }

      if (body.prepare === "session") {
        console.log("[agent/executions] live-flow:prepare-session:start", {
          ownerAddress,
          requestId: body.requestId,
          sessionId: body.sessionId
        });
        const prepared = await buildSessionSigningRequest(body.sessionId, ownerAddress);
        console.log("[agent/executions] live-flow:prepare-session:done", {
          elapsedMs: Date.now() - startedAt,
          requestId: body.requestId,
          sessionId: body.sessionId
        });
        return NextResponse.json({
          prepared,
          request: approvedRequest,
          session
        });
      }

      if (body.submit === "bootstrap") {
        console.log("[agent/executions] live-flow:submit-bootstrap:start", {
          ownerAddress,
          requestId: body.requestId,
          sessionId: body.sessionId
        });
        const submission = await sendUserOperation(await buildBootstrapUserOp(body.sessionId, body.ownerSignature, ownerAddress));
        console.log("[agent/executions] live-flow:submit-bootstrap:done", {
          elapsedMs: Date.now() - startedAt,
          txHash: submission.txHash,
          userOpHash: submission.userOpHash
        });
        return NextResponse.json({
          submission,
          request: approvedRequest,
          session: await getSessionRecord(body.sessionId, { ownerAddress })
        });
      }

      if (body.submit === "session") {
        console.log("[agent/executions] live-flow:submit-session:start", {
          ownerAddress,
          requestId: body.requestId,
          sessionId: body.sessionId
        });
        const prepared = await buildSessionUserOp(body.sessionId, body.sessionSignature, body.signerAddress, ownerAddress);
        const submission = await sendUserOperation(prepared);
        execution = await executeAgentRequestWithOptions({
          requestId: body.requestId ?? session.requestId ?? body.sessionId,
          sessionId: body.sessionId,
          ownerAddress,
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
        console.log("[agent/executions] live-flow:submit-session:done", {
          elapsedMs: Date.now() - startedAt,
          txHash: submission.txHash,
          userOpHash: submission.userOpHash
        });
      } else {
        throw new Error("For live execution, set prepare or submit to bootstrap or session");
      }
    } else {
      execution = await executeAgentRequestWithOptions(body);
    }
    console.log("[agent/executions] done", {
      elapsedMs: Date.now() - startedAt,
      requestId: body.requestId,
      sessionId: body.sessionId,
      live: body.live === true
    });
    return NextResponse.json({ execution }, { status: 201 });
  } catch (error) {
    console.error("[agent/executions] error", error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
