import type { RegisteredTool } from "./tool-registry.js";
import { ToolValidationError } from "./tool-registry.js";

type Token = { readonly type: "number"; readonly value: number } | { readonly type: "operator"; readonly value: string };

function tokenize(expression: string): Token[] {
  if (expression.length > 200) throw new ToolValidationError("expression_too_large", "Expression exceeds 200 characters");
  const tokens: Token[] = [];
  let index = 0;
  while (index < expression.length) {
    const rest = expression.slice(index);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) { index += whitespace[0].length; continue; }
    const number = /^(?:\d+(?:\.\d*)?|\.\d+)/.exec(rest);
    if (number) { tokens.push({ type: "number", value: Number(number[0]) }); index += number[0].length; continue; }
    const operator = rest[0];
    if (operator && "+-*/()".includes(operator)) { tokens.push({ type: "operator", value: operator }); index += 1; continue; }
    throw new ToolValidationError("invalid_expression", `Unexpected character at position ${index}`);
  }
  return tokens;
}

function calculate(expression: string): number {
  const tokens = tokenize(expression);
  let cursor = 0;
  const peek = () => tokens[cursor];
  const consume = () => tokens[cursor++];
  const primary = (): number => {
    const token = consume();
    if (!token) throw new ToolValidationError("invalid_expression", "Expression ended unexpectedly");
    if (token.type === "number") return token.value;
    if (token.value === "+") return primary();
    if (token.value === "-") return -primary();
    if (token.value === "(") {
      const value = sum();
      const closing = consume();
      if (closing?.type !== "operator" || closing.value !== ")") throw new ToolValidationError("invalid_expression", "Missing closing parenthesis");
      return value;
    }
    throw new ToolValidationError("invalid_expression", "Expected a number or opening parenthesis");
  };
  const product = (): number => {
    let value = primary();
    while (peek()?.type === "operator" && (peek()?.value === "*" || peek()?.value === "/")) {
      const operator = consume();
      const right = primary();
      if (operator?.value === "/" && right === 0) throw new ToolValidationError("division_by_zero", "Division by zero is not allowed");
      value = operator?.value === "*" ? value * right : value / right;
    }
    return value;
  };
  const sum = (): number => {
    let value = product();
    while (peek()?.type === "operator" && (peek()?.value === "+" || peek()?.value === "-")) {
      const operator = consume();
      const right = product();
      value = operator?.value === "+" ? value + right : value - right;
    }
    return value;
  };
  const result = sum();
  if (cursor !== tokens.length || !Number.isFinite(result)) throw new ToolValidationError("invalid_expression", "Expression is invalid or non-finite");
  return result;
}

export interface StarterToolSet {
  readonly tools: readonly RegisteredTool[];
  readonly records: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
}

export function createStarterTools(maxEchoBytes = 4_096): StarterToolSet {
  const records = new Map<string, Readonly<Record<string, unknown>>>();
  const calculator: RegisteredTool = {
    definition: {
      name: "calculator", version: "1.0.0", description: "Evaluate bounded arithmetic with +, -, *, /, and parentheses.", risk: "read", timeoutMs: 1_000,
      inputSchema: { type: "object", additionalProperties: false, required: ["expression"], properties: { expression: { type: "string", minLength: 1, maxLength: 200 } } },
      outputSchema: { type: "object", additionalProperties: false, required: ["result"], properties: { result: { type: "number" } } },
    },
    execute: (arguments_) => ({ result: calculate(String(arguments_.expression)) }),
  };
  const diagnostic: RegisteredTool = {
    definition: {
      name: "diagnostic_echo", version: "1.0.0", description: "Return a small structured payload for diagnostics.", risk: "read", timeoutMs: 1_000,
      inputSchema: { type: "object", additionalProperties: false, required: ["payload"], properties: { payload: {} } },
      outputSchema: { type: "object", additionalProperties: false, required: ["payload"], properties: { payload: {} } },
    },
    execute: (arguments_) => {
      const encoded = JSON.stringify(arguments_.payload);
      if (encoded === undefined || Buffer.byteLength(encoded) > maxEchoBytes) throw new ToolValidationError("payload_too_large", `Echo payload exceeds ${maxEchoBytes} bytes`);
      return { payload: structuredClone(arguments_.payload) };
    },
  };
  const save: RegisteredTool = {
    definition: {
      name: "memory_save", version: "1.0.0", description: "Save one structured test record by ID.", risk: "write", timeoutMs: 1_000,
      inputSchema: { type: "object", additionalProperties: false, required: ["id", "data"], properties: { id: { type: "string", minLength: 1, maxLength: 100 }, data: { type: "object" } } },
      outputSchema: { type: "object", additionalProperties: false, required: ["id", "created"], properties: { id: { type: "string" }, created: { type: "boolean" } } },
    },
    execute: (arguments_) => {
      const id = String(arguments_.id);
      if (records.has(id)) throw new ToolValidationError("duplicate_record", `Record '${id}' already exists`);
      records.set(id, structuredClone(arguments_.data as Record<string, unknown>));
      return { id, created: true };
    },
  };
  const search: RegisteredTool = {
    definition: {
      name: "memory_search", version: "1.0.0", description: "Search test records by one top-level field equality.", risk: "read", timeoutMs: 1_000,
      inputSchema: { type: "object", additionalProperties: false, properties: { field: { type: "string" }, equals: {} }, dependencies: { field: ["equals"], equals: ["field"] } },
      outputSchema: { type: "object", additionalProperties: false, required: ["records"], properties: { records: { type: "array", items: { type: "object", required: ["id", "data"], properties: { id: { type: "string" }, data: { type: "object" } } } } } },
    },
    execute: (arguments_) => ({
      records: [...records.entries()]
        .filter(([, data]) => arguments_.field === undefined || data[String(arguments_.field)] === arguments_.equals)
        .map(([id, data]) => ({ id, data: structuredClone(data) })),
    }),
  };
  return { tools: [calculator, diagnostic, save, search], records };
}
