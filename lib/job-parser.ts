export type JobSearchParams = {
  title: string;
  location: string | null;
  company: string | null;
  keywords: string[];
};

export async function parseJobDescription(
  rawContent: string
): Promise<JobSearchParams> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set");

  const model = process.env.OPENROUTER_MODEL ?? "anthropic/claude-haiku-4-5";

  const prompt = `Extract structured search parameters from the following job description.

Return ONLY a valid JSON object with these fields:
- title: the job title (string, required)
- location: city or region if mentioned, otherwise null
- company: hiring company name if mentioned, otherwise null
- keywords: array of 3–8 relevant skills or keywords for sourcing candidates (strings)

Job description:
${rawContent.slice(0, 4000)}

JSON:`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      max_tokens: 256,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter error ${res.status}: ${text}`);
  }

  const data = (await res.json()) as {
    choices: { message: { content: string } }[];
  };

  const content = data.choices[0]?.message?.content ?? "";

  // Strip markdown code fences if present
  const jsonStr = content.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/, "").trim();

  const parsed = JSON.parse(jsonStr) as Partial<JobSearchParams>;

  return {
    title: parsed.title ?? "Candidate",
    location: parsed.location ?? null,
    company: parsed.company ?? null,
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
  };
}
