import type { NextRequest } from "next/server";
import { handleTrainingApiRequest } from "../../../../lib/training-api/http";

type RouteContext = { params: Promise<{ path?: string[] }> };

async function handle(request: NextRequest, context: RouteContext) {
  const { path = [] } = await context.params;
  return handleTrainingApiRequest(request, path);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
