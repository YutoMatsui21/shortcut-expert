export function withCleanup(action, cleanup) {
  let result;
  let failed = false;
  let operationError;
  try {
    result = action();
  } catch (error) {
    failed = true;
    operationError = error;
  }
  try {
    cleanup();
  } catch (error) {
    if (failed)
      throw new AggregateError(
        [operationError, error],
        "Operation and cleanup failed",
      );
    throw error;
  }
  if (failed) throw operationError;
  return result;
}
