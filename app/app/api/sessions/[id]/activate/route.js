import { NextResponse } from "next/server";

import { markSessionSubmitted } from "../../../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function POST(request, context) {
  try {
    const body = await request.json().catch(() => ({}));
    const { id } = await context.params;
    const ownerAddress = body?.ownerAddress ?? body?.requestOwnerAddress ?? body?.signerAddress ?? null;
    const session = await markSessionSubmitted(id, {
      bootstrapTxHash: body?.bootstrapTxHash,
      activate: true,
      ownerAddress
    }, ownerAddress);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
