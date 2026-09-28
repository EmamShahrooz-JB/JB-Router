import { OPENAI_BLOCK } from "../schema/index.js";

// Collapse an OpenAI content-part array: text-only arrays become a plain string
// (newline-joined), anything multimodal is returned as-is. Text-only *strings* are
// accepted by every OpenAI-compatible endpoint, while multi-part text arrays are
// rejected by several of them (the "string-safe" guarantee for /v1/messages).
export function collapseTextParts(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return parts;
  if (parts.every((part) => part?.type === OPENAI_BLOCK.TEXT)) {
    return parts.map((part) => part.text || "").join("\n");
  }
  return parts;
}
