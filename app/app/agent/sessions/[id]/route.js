import { NextResponse } from "next/server";
import { getSessionById } from "../../../../lib/domain.js";
import { verifyMessage } from "viem";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  try {
    const { id } = await context.params;
    const url = new URL(_request.url);
    const ownerAddress = url.searchParams.get("ownerAddress");
    const challenge = url.searchParams.get("challenge");
    const signature = url.searchParams.get("signature");
    if (!ownerAddress || !challenge || !signature) {
      throw new Error("ownerAddress, challenge, and signature are required");
    }
    const valid = await verifyMessage({
      address: ownerAddress,
      message: challenge,
      signature
    });
    if (!valid) {
      throw new Error("Invalid owner signature");
    }
    const session = await getSessionById(id, ownerAddress);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
}
