/**
 * Parameter Serialization Utility
 *
 * Converts JavaScript values to their string representation for use in js_statement.
 * Handles primitives, arrays, objects, and special values like undefined/null.
 */

/**
 * Serialize a JavaScript value to its string representation
 *
 * @param value - The value to serialize
 * @returns String representation that can be evaluated as JavaScript
 *
 * @example
 * serializeParameter(5) → "5"
 * serializeParameter("hello") → '"hello"'
 * serializeParameter([1, 2, 3]) → '[1,2,3]'
 * serializeParameter({a: 1}) → '{"a":1}'
 * serializeParameter(null) → "null"
 * serializeParameter(undefined) → "undefined"
 */
export function serializeParameter(value: any): string {
  // Handle primitives and special values
  if (value === null) {
    return 'null';
  }

  if (value === undefined) {
    return 'undefined';
  }

  if (typeof value === 'string') {
    // Escape special characters and wrap in quotes
    return JSON.stringify(value);
  }

  if (typeof value === 'number') {
    // Handle special number values
    if (Number.isNaN(value)) {
      return 'NaN';
    }
    if (!Number.isFinite(value)) {
      return value > 0 ? 'Infinity' : '-Infinity';
    }
    return String(value);
  }

  if (typeof value === 'boolean') {
    return String(value);
  }

  // Handle arrays
  if (Array.isArray(value)) {
    const serializedElements = value.map(serializeParameter);
    return `[${serializedElements.join(',')},]`;
  }

  // Handle objects (plain objects only - will use JSON.stringify)
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  // Fallback for functions or other complex types
  throw new Error(`Cannot serialize value of type ${typeof value}: ${value}`);
}

/**
 * Serialize an array of parameters for function call
 *
 * @param parameters - Array of parameters to serialize
 * @returns Comma-separated string of serialized parameters
 *
 * @example
 * serializeParameters([1, "hello", true]) → '1,"hello",true'
 * serializeParameters([]) → ''
 */
export function serializeParameters(parameters: any[]): string {
  if (!parameters || parameters.length === 0) {
    return '';
  }

  return parameters.map(serializeParameter).join(',');
}

/**
 * Build a function call statement from function name and parameters
 *
 * @param functionName - Name of the function to call
 * @param parameters - Array of parameters to pass
 * @param moduleName - Optional module name for require() pattern
 * @returns JavaScript statement string
 *
 * @example
 * buildFunctionCall("myFunc", [1, 2]) → "myFunc(1,2)"
 * buildFunctionCall("add", [5, 3], "Utils") → 'require("Utils").add(5,3)'
 */
export function buildFunctionCall(
  functionName: string,
  parameters: any[] = [],
  moduleName?: string
): string {
  const serializedParams = serializeParameters(parameters);

  if (moduleName) {
    // Module function call: require("Module").functionName(params)
    return `require(${JSON.stringify(moduleName)}).${functionName}(${serializedParams})`;
  } else {
    // Direct function call: functionName(params)
    return `${functionName}(${serializedParams})`;
  }
}
