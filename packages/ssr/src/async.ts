export async function resolveMaybePromise<T>(value: T | Promise<T>): Promise<T> {
  return await value;
}
