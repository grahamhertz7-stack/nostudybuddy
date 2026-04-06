// nostudybuddy/netlify/functions/solve.js
// Multi-AI solver: Claude + OpenAI + Gemini + Grok answer simultaneously,
// then Claude synthesizes the best combined answer.

const https = require("https");

// ─── Helpers ────────────────────────────────────────────────────────────────

function httpsPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(data),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let raw = "";
      res.on("data", (chunk) => (raw += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch (e) {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

// ─── Individual AI callers ───────────────────────────────────────────────────

async function askClaude(apiKey, question, imageBase64, imageMime) {
  const content = [];
  if (imageBase64) {
    content.push({
      type: "image",
      source: { type: "base64", media_type: imageMime || "image/jpeg", data: imageBase64 },
    });
  }
  content.push({ type: "text", text: question || "Answer the question shown in the image." });

  const res = await httpsPost(
    "api.anthropic.com",
    "/v1/messages",
    {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    {
      model: "claude-haiku-20240307",
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    }
  );
  if (res.status !== 200) throw new Error(`Claude error ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.content[0].text;
}

async function askOpenAI(apiKey, question, imageBase64, imageMime) {
  const content = [];
  if (imageBase64) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${imageMime || "image/jpeg"};base64,${imageBase64}` },
    });
  }
  content.push({ type: "text", text: question || "Answer the question shown in the image." });

  const res = await httpsPost(
    "api.openai.com",
    "/v1/chat/completions",
    { Authorization: `Bearer ${apiKey}` },
    {
      model: "gpt-4o-mini",
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    }
  );
  if (res.status !== 200) throw new Error(`OpenAI error ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.choices[0].message.content;
}

async function askGemini(apiKey, question, imageBase64, imageMime) {
  const parts = [];
  if (imageBase64) {
    parts.push({ inline_data: { mime_type: imageMime || "image/jpeg", data: imageBase64 } });
  }
  parts.push({ text: question || "Answer the question shown in the image." });

  const res = await httpsPost(
    "generativelanguage.googleapis.com",
    `/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
    {},
    { contents: [{ parts }] }
  );
  if (res.status !== 200) throw new Error(`Gemini error ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.candidates[0].content.parts[0].text;
}

async function askGrok(apiKey, question, imageBase64, imageMime) {
  // Grok uses an OpenAI-compatible API endpoint
  const content = [];
  if (imageBase64) {
    content.push({
      type: "image_url",
      image_url: { url: `data:${imageMime || "image/jpeg"};base64,${imageBase64}` },
    });
  }
  content.push({ type: "text", text: question || "Answer the question shown in the image." });

  const res = await httpsPost(
    "api.x.ai",
    "/v1/chat/completions",
    { Authorization: `Bearer ${apiKey}` },
    {
      model: "grok-3-mini",
      max_tokens: 1024,
      messages: [{ role: "user", content }],
    }
  );
  if (res.status !== 200) throw new Error(`Grok error ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.choices[0].message.content;
}

// ─── Synthesizer ─────────────────────────────────────────────────────────────

async function synthesize(claudeKey, question, answers) {
  const answersText = Object.entries(answers)
    .map(([ai, ans]) => `### ${ai}\n${ans}`)
    .join("\n\n");

  const prompt = `You are a synthesis engine. Multiple AI models answered the following question. 
Review all answers and produce ONE definitive, accurate, and concise answer that combines the best elements.
Do not mention which AI said what. Just give the best answer directly.

QUESTION:
${question || "(See image provided)"}

AI ANSWERS:
${answersText}

SYNTHESIZED ANSWER:`;

  const res = await httpsPost(
    "api.anthropic.com",
    "/v1/messages",
    {
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
    },
    {
      model: "claude-haiku-20240307",
      max_tokens: 1024,
      messages: [{ role: "user", content: prompt }],
    }
  );
  if (res.status !== 200) throw new Error(`Synthesizer error ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.content[0].text;
}

// ─── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async (event) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: corsHeaders, body: "" };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: corsHeaders, body: JSON.stringify({ error: "Method not allowed" }) };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const { question, imageBase64, imageMime, userKeys = {} } = body;

    if (!question && !imageBase64) {
      return {
        statusCode: 400,
        headers: corsHeaders,
        body: JSON.stringify({ error: "No question or image provided." }),
      };
    }

    // Resolve API keys: prefer user-supplied keys, fall back to server keys
    const claudeKey  = userKeys.anthropic || process.env.ANTHROPIC_API_KEY;
    const openaiKey  = userKeys.openai    || process.env.OPENAI_API_KEY;
    const geminiKey  = userKeys.gemini    || process.env.GEMINI_API_KEY;
    const grokKey    = userKeys.grok      || process.env.GROK_API_KEY;

    // Run all available AIs in parallel (skip if no key available)
    const tasks = {};
    if (claudeKey)  tasks.Claude  = askClaude(claudeKey,  question, imageBase64, imageMime);
    if (openaiKey)  tasks.ChatGPT = askOpenAI(openaiKey,  question, imageBase64, imageMime);
    if (geminiKey)  tasks.Gemini  = askGemini(geminiKey,  question, imageBase64, imageMime);
    if (grokKey)    tasks.Grok    = askGrok(grokKey,      question, imageBase64, imageMime);

    if (Object.keys(tasks).length === 0) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: "No AI API keys are configured." }),
      };
    }

    // Settle all promises (don't let one failure kill the rest)
    const settled = await Promise.allSettled(Object.entries(tasks).map(([name, p]) => p.then((ans) => ({ name, ans }))));

    const answers = {};
    const errors  = {};
    for (const result of settled) {
      if (result.status === "fulfilled") {
        answers[result.value.name] = result.value.ans;
      } else {
        // Extract AI name from the error message prefix
        const msg = result.reason?.message || String(result.reason);
        const aiName = msg.startsWith("Claude") ? "Claude"
          : msg.startsWith("OpenAI") ? "ChatGPT"
          : msg.startsWith("Gemini") ? "Gemini"
          : msg.startsWith("Grok")   ? "Grok"
          : "Unknown";
        errors[aiName] = msg;
      }
    }

    if (Object.keys(answers).length === 0) {
      return {
        statusCode: 500,
        headers: corsHeaders,
        body: JSON.stringify({ error: "All AI models failed.", details: errors }),
      };
    }

    // Synthesize if more than one answer, otherwise just return the single answer
    let synthesized = null;
    if (Object.keys(answers).length > 1 && claudeKey) {
      try {
        synthesized = await synthesize(claudeKey, question, answers);
      } catch (e) {
        synthesized = null; // Non-fatal — frontend will still show individual answers
      }
    }

    return {
      statusCode: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ answers, synthesized, errors }),
    };
  } catch (err) {
    console.error("solve.js error:", err);
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message || "Internal server error" }),
    };
  }
};
