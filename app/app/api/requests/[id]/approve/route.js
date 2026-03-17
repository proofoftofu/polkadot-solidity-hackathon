import { NextResponse } from "next/server";
import { approveRequest } from "../../../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function POST(request, context) {
  try {
    const startedAt = Date.now();
    const body = await request.json().catch(() => ({}));
    const { id } = await context.params;
    console.log("[api/requests/approve] request", { id, ownerAddress: body?.ownerAddress });
    const session = await approveRequest(id, body?.ownerAddress);
    console.log("[api/requests/approve] response", {
      id,
      sessionId: session.id,
      elapsedMs: Date.now() - startedAt,
      dispatcherTransactions: session.approvalMeta?.dispatcherTransactions ?? []
    });
    return NextResponse.json({ session });
  } catch (error) {
    console.error("[api/requests/approve] error", error);
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
