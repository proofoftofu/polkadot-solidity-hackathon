import { NextResponse } from "next/server";

import { removeSessionById } from "../../../../lib/domain.js";

export async function DELETE(_request, context) {
  try {
    const params = await context.params;
    const session = await removeSessionById(params.id);
    return NextResponse.json({ session });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
}
