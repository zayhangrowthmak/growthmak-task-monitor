import { NextResponse } from "next/server";

// Kept as a no-op pass-through (the nav now reads the path in the browser).
export function middleware() {
  return NextResponse.next();
}
export const config = { matcher: [] };
