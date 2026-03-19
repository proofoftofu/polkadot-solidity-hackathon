import { NextResponse } from "next/server";
import { getSessionById } from "../../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  try {
    const { id } = await context.params;
    const url = new URL(_request.url);
    const ownerAddress = url.searchParams.get("ownerAddress");
    if (!ownerAddress) {
      throw new Error("ownerAddress is required");
    }
    const session = await getSessionById(id, ownerAddress);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
}
