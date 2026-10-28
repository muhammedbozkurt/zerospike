/**
 * Loads the record the calculator was opened on. Found: hands it over. Gone (or
 * unreadable): reports it once so the screen can say so and close, instead of
 * sitting on a skeleton that never resolves.
 */
export async function resolveRecord<T>(
  load: () => Promise<T | null | undefined>,
  onFound: (record: T) => void,
  onMissing: () => void,
  onError?: (err: unknown) => void
): Promise<void> {
  let record: T | null | undefined;
  try {
    record = await load();
  } catch (err) {
    onError?.(err);
    onMissing();
    return;
  }
  if (record == null) {
    onMissing();
    return;
  }
  onFound(record);
}
