exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request' }) };
  }

  const { question, userKey } = body;
  if (!question || !question.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: 'No question provided.' }) };
  }

  const apiKey = (userKey && userKey.startsWith('sk-ant-')) ? userKey : process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'No API key configured.' }) };
  }

  const system = `You are a quiz-solving assistant. The user will paste one or more quiz questions.

For each question, respond with a JSON array. Each item must have:
- "question": a short label like "Question 1" or the first few words of the question
- "answer": the direct correct answer — just the answer, like you'd write on a test
- "explanation": 1-2 sentences explaining why, only if it adds real value

Return ONLY a valid JSON array. No markdown, no code fences, no extra text. Example:
[{"question":"Q1","answer":"The mitochondria","explanation":"It produces ATP, the cell's energy currency."}]`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system,
        messages: [{ role: 'user', content: question }]
      })
    });

    if (!response.ok) {
      const err = await response.text();
      return { statusCode: 502, body: JSON.stringify({ error: 'API error: ' + err }) };
    }

    const data = await response.json();
    const raw = data.content.map(b => b.text || '').join('');
    const clean = raw.replace(/```json|```/g, '').trim();

    let items;
    try { items = JSON.parse(clean); } catch(e) { items = [{ question: 'Answer', answer: raw, explanation: '' }]; }
    if (!Array.isArray(items)) items = [items];

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers: items })
    };

  } catch(err) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server error: ' + err.message }) };
  }
};
