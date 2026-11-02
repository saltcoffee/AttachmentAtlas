/** A resolved promise alone is not proof of a successful cleanup. */
export function requireCompletedResult(result) {
  if (
    !result ||
    result.outcome !== 'completed' ||
    result.finalVerification !== 'passed' ||
    !Array.isArray(result.documents) ||
    !Array.isArray(result.images) ||
    [...result.documents, ...result.images].some((action) => action.state !== 'verified')
  ) {
    throw new Error(
      `Benchmark task did not complete: ${JSON.stringify({
        outcome: result?.outcome,
        cancellationRequested: result?.cancellationRequested,
        stage: result?.stoppedAt,
        issue: result?.issue,
      })}`,
    );
  }
}
