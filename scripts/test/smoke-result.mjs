export function smokeSucceeded(result) {
  return result.status === 0 && result.stdout?.includes("COACH_SMOKE_OK ");
}

export function smokeFailureSummary(result, mode, boot) {
  return JSON.stringify({
    event: "COACH_SMOKE_PROCESS_FAILED",
    mode,
    boot,
    status: result.status,
    signal: result.signal ?? null,
    error: result.error?.message ?? null,
    stdoutBytes: Buffer.byteLength(result.stdout ?? ""),
    stderrBytes: Buffer.byteLength(result.stderr ?? ""),
  });
}
