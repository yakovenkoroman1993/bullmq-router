export function get<
  T,
  Default = undefined
>(
  obj: T,
  path: string,
  defaultValue?: Default
): unknown | Default {
  if (!path) {
    return obj;
  }

  const keys = path.split('.');
  let result: unknown = obj;

  for (const key of keys) {
    if (
      result !== null &&
      typeof result === 'object' &&
      key in result
    ) {
      result = result[key as keyof typeof result];
    } else {
      return defaultValue;
    }
  }

  return result === undefined ? defaultValue : result;
}