import { NextResponse } from "next/server";
import { ctxForCurrentUser } from "@/server/core/action";
import { DomainError } from "@/server/core/errors";
import { rendersService } from "@/server/modules/renders/service";

/**
 * Served inline rather than as a download: this is an <img> on the Renders tab. A Render's
 * bytes never change once it is ready, so it is immutable, and private because the image
 * belongs to one PM's Project.
 */
export async function GET(_req: Request, { params }: RouteContext<"/api/renders/[id]/image">) {
  const { id } = await params;
  try {
    const ctx = await ctxForCurrentUser();
    const { render, bytes } = await rendersService.image(ctx, id);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": render.mimeType ?? "image/jpeg",
        "Content-Disposition": "inline",
        "Cache-Control": "private, max-age=31536000, immutable",
      },
    });
  } catch (e) {
    if (e instanceof DomainError)
      return NextResponse.json({ error: e.message }, { status: e.code === "not_found" ? 404 : 403 });
    throw e;
  }
}
