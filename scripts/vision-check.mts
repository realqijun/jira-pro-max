import "dotenv/config";
import { readFileSync } from "node:fs";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
const model = createOpenAI({ apiKey: process.env.OPENAI_API_KEY })("gpt-4o-mini");
const res = await generateText({
  model,
  messages: [
    {
      role: "user",
      content: [
        { type: "text", text: "Transcribe all text in this PDF verbatim, nothing else." },
        { type: "file", data: readFileSync("/tmp/scan.pdf"), mediaType: "application/pdf" },
      ],
    },
  ],
});
console.log(res.text);
