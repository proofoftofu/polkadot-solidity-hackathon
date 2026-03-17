import { NextResponse } from "next/server";
import { prepareWalletForOwner } from "../../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const result = await prepareWalletForOwner(body?.ownerAddress);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
