export function getNestedValue(obj: any, path: string): any {
  if (!path) return obj;
  const keys = path.split('.');
  let current = obj;
  for (const key of keys) {
    if (current === null || typeof current !== 'object' || !(key in current)) {
      return undefined;
    }
    current = current[key];
  }
  return current;
}

export function setNestedValue(obj: any, path: string, value: any): boolean {
  if (!path) return false; // Cannot set root object this way
  const keys = path.split('.');
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current === null || typeof current !== 'object') {
      return false; // Path is not valid
    }
    if (!current[key] || typeof current[key] !== 'object') {
      current[key] = {}; // Create a new object if path doesn't exist or not an object
    }
    current = current[key];
  }
  const finalKey = keys[keys.length - 1];
  if (current === null || typeof current !== 'object') {
    return false; // Parent for final key is not an object
  }
  current[finalKey] = value;
  return true;
} 