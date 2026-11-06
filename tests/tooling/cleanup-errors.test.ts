import assert from "node:assert/strict";
import { test } from "node:test";
import { withCleanup } from "../../scripts/dev/cleanup.mjs";

test("cleanup preserves the operation and cleanup failures", () => {
  const operation = new Error("operation failed");
  const cleanup = new Error("cleanup failed");
  assert.throws(
    () =>
      withCleanup(
        () => {
          throw operation;
        },
        () => {
          throw cleanup;
        },
      ),
    (error) =>
      error instanceof AggregateError &&
      error.errors[0] === operation &&
      error.errors[1] === cleanup,
  );
  assert.throws(
    () =>
      withCleanup(
        () => {
          throw operation;
        },
        () => {},
      ),
    (error) => error === operation,
  );
  assert.throws(
    () =>
      withCleanup(
        () => 1,
        () => {
          throw cleanup;
        },
      ),
    (error) => error === cleanup,
  );
  assert.equal(
    withCleanup(
      () => 42,
      () => {},
    ),
    42,
  );
});
