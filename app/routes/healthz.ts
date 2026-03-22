import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import prisma from "../db.server";

export const loader = async (_args: LoaderFunctionArgs) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return json({ ok: true, db: "ok", ts: new Date().toISOString() }, { status: 200 });
  } catch {
    return json({ ok: false, db: "down", ts: new Date().toISOString() }, { status: 503 });
  }
};
