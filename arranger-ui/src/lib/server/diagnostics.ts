import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

export function diagnosticError(code: string, message: string, status: number, cause?: unknown) {
  const diagnosticId = randomUUID();
  console.error(`[${diagnosticId}] ${code}`, cause ?? message);
  return NextResponse.json({ ok: false, code, error: message, diagnosticId }, {
    status,
    headers: { "X-Arranger-Diagnostic-Id": diagnosticId },
  });
}
