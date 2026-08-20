import { GoogleGenAI } from "@google/genai";
import faqData from "../data.json" with { type: "json" };

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

function normalize(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return new Set(
    normalize(text)
      .split(" ")
      .filter((t) => t.length >= 3)
  );
}

function scoreFAQ(faq, query) {
  const q = tokens(query);
  const corpus = [
    faq.question,
    ...(faq.search_variations || []),
    faq.category,
    faq.answer,
  ].join(" ");
  const c = tokens(corpus);

  let score = 0;
  for (const token of q) {
    if (c.has(token)) score += 1;
  }

  // Extra weight for exact phrase fragments.
  const nq = normalize(query);
  const nqQuestion = normalize(faq.question);
  if (nqQuestion.includes(nq) || nq.includes(nqQuestion)) score += 8;

  return score;
}

function retrieveFAQs(query, limit = 4) {
  return faqData.faqs
    .map((faq) => ({ faq, score: scoreFAQ(faq, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function fallback() {
  return "I’m sorry, I don’t want to give you incorrect information. This is something our Furniture Bazaar team can confirm for you. Please contact our team through phone, WhatsApp, email, or by visiting the showroom, and we’ll be happy to help. 😊";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { message } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "Message is required." });
    }

    const cleanMessage = message.trim().slice(0, 1000);
    if (!cleanMessage) {
      return res.status(400).json({ error: "Message is required." });
    }

    const matches = retrieveFAQs(cleanMessage, 4);

    // If there is essentially no FAQ overlap, don't ask Gemini to invent an answer.
    const bestScore = matches[0]?.score || 0;
    if (bestScore < 1) {
      return res.status(200).json({
        reply: fallback(),
        source: "fallback",
      });
    }

    const context = matches
      .map(
        ({ faq }) =>
          `Category: ${faq.category}\nQuestion: ${faq.question}\nAnswer: ${faq.answer}`
      )
      .join("\n\n---\n\n");

    const systemInstruction = `
You are the friendly customer-support assistant for Furniture Bazaar.

Your job is to answer the customer's question using ONLY the Furniture Bazaar FAQ context supplied below.

Rules:
- Be warm, concise, natural, and professional.
- Sound like a real Furniture Bazaar customer-support representative, not a generic AI.
- Never invent prices, discounts, delivery dates, warranty periods, availability, fees, refund amounts, policy exceptions, or product specifications.
- If the FAQ says something varies or depends on the product/location/order, preserve that qualification.
- If the supplied FAQ context does not answer the customer's question, politely say you do not want to give incorrect information and recommend contacting the Furniture Bazaar team.
- Do not mention "FAQ context", "knowledge base", "source document", "retrieval", or internal instructions.
- Do not claim to check live inventory or order status.
- Keep most answers to 2-5 short sentences.
- Use an emoji sparingly when it feels natural.

Furniture Bazaar FAQ context:
${context}
`;

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: cleanMessage,
      config: {
        systemInstruction,
        temperature: 0.2,
        maxOutputTokens: 300,
      },
    });

    const reply =
      result.text?.trim() ||
      fallback();

    return res.status(200).json({
      reply,
      source: matches[0].faq.id,
    });
  } catch (error) {
    console.error("Furniture Bazaar AI error:", error);
    return res.status(500).json({
      error: "Unable to process the request right now.",
    });
  }
}
