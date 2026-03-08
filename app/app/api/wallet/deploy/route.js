import { NextResponse } from "next/server";
import { deployWalletForOwner } from "../../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const body = await request.json();
    const wallet = await deployWalletForOwner(body?.ownerAddress);
    return NextResponse.json({ wallet });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
