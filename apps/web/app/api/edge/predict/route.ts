import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "VeloxEdge edge predict route is not implemented yet" },
    { status: 501 },
  );
}
