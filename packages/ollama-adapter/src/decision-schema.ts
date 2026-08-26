import { z } from "zod";

const toolInvocationSchema = z.object({
  invocationId: z.string().min(1),
  name: z.string().min(1),
  arguments: z.record(z.string(), z.unknown()),
});

export const agentDecisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("invoke_tool"), tool: toolInvocationSchema, rationaleSummary: z.string().min(1), userMessage: z.string() }),
  z.object({ kind: z.literal("complete"), summary: z.string().min(1), evidence: z.array(z.string().min(1)), rationaleSummary: z.string().min(1), userMessage: z.string() }),
  z.object({ kind: z.literal("cannot_continue"), reason: z.string().min(1), rationaleSummary: z.string().min(1), userMessage: z.string() }),
]);

export const agentDecisionJsonSchema = {
  oneOf: [
    {
      type: "object", additionalProperties: false, required: ["kind", "tool", "rationaleSummary", "userMessage"],
      properties: {
        kind: { const: "invoke_tool" },
        tool: {
          type: "object", additionalProperties: false, required: ["invocationId", "name", "arguments"],
          properties: { invocationId: { type: "string", minLength: 1 }, name: { type: "string", minLength: 1 }, arguments: { type: "object" } },
        },
        rationaleSummary: { type: "string", minLength: 1 }, userMessage: { type: "string" },
      },
    },
    {
      type: "object", additionalProperties: false, required: ["kind", "summary", "evidence", "rationaleSummary", "userMessage"],
      properties: { kind: { const: "complete" }, summary: { type: "string", minLength: 1 }, evidence: { type: "array", items: { type: "string", minLength: 1 } }, rationaleSummary: { type: "string", minLength: 1 }, userMessage: { type: "string" } },
    },
    {
      type: "object", additionalProperties: false, required: ["kind", "reason", "rationaleSummary", "userMessage"],
      properties: { kind: { const: "cannot_continue" }, reason: { type: "string", minLength: 1 }, rationaleSummary: { type: "string", minLength: 1 }, userMessage: { type: "string" } },
    },
  ],
} as const;
