import { NextResponse } from "next/server";
import { getWalletStatus } from "../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ownerAddress = searchParams.get("ownerAddress") ?? undefined;
  const wallet = await getWalletStatus(ownerAddress);
  return NextResponse.json({ wallet });
}
