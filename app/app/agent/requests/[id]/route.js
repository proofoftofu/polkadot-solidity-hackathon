import { NextResponse } from "next/server";

import { getRequestById } from "../../../../lib/domain.js";

export const dynamic = "force-dynamic";

export async function GET(_request, context) {
  try {
    const { id } = await context.params;
    const request = await getRequestById(id);
    return NextResponse.json({ request });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
}
