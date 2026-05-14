function buildEvaluationExpression(expressionOrFunction, args = []) {
  if (typeof expressionOrFunction === "function") {
    return `(${expressionOrFunction.toString()})(...${JSON.stringify(args)})`;
  }

  if (typeof expressionOrFunction !== "string") {
    throw new Error("orbit.evaluate() expects a JavaScript function or expression string.");
  }

  if (args.length > 0) {
    throw new Error("orbit.evaluate() only accepts arguments when the first parameter is a function.");
  }

  return expressionOrFunction;
}

function formatEvaluationLabel(expressionOrFunction) {
  if (typeof expressionOrFunction === "function") {
    return expressionOrFunction.name ? `${expressionOrFunction.name}()` : "function";
  }

  return String(expressionOrFunction).replace(/\s+/g, " ").trim().slice(0, 80) || "expression";
}

function formatEvaluationError(exceptionDetails = {}) {
  const exception = exceptionDetails.exception || {};
  return exception.description || exception.value || exceptionDetails.text || "Page evaluation failed.";
}

function deserializeRemoteValue(remoteObject = {}) {
  if (Object.prototype.hasOwnProperty.call(remoteObject, "value")) {
    return remoteObject.value;
  }

  if (remoteObject.unserializableValue !== undefined) {
    const value = remoteObject.unserializableValue;

    if (typeof value === "string" && value.endsWith("n")) {
      return BigInt(value.slice(0, -1));
    }

    if (value === "NaN") return NaN;
    if (value === "Infinity") return Infinity;
    if (value === "-Infinity") return -Infinity;
    if (value === "-0") return -0;
  }

  return undefined;
}

module.exports = {
  buildEvaluationExpression,
  deserializeRemoteValue,
  formatEvaluationError,
  formatEvaluationLabel
};
