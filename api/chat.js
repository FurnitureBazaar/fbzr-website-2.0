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
    if (c.has(token)) {
      score += 1;
    }
  }

  // Extra weight for exact phrase matches
  const nq = normalize(query);
  const nqQuestion = normalize(faq.question);

  if (
    nqQuestion.includes(nq) ||
    nq.includes(nqQuestion)
  ) {
    score += 8;
  }

  return score;
}

function retrieveFAQs(query, limit = 4) {
  return faqData.faqs
    .map((faq) => ({
      faq,
      score: scoreFAQ(faq, query),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function fallback() {
  return "I’m sorry, I don’t want to give you incorrect information. This is something our Furniture Bazaar team can confirm for you. Please contact our team through phone, WhatsApp, email, or by visiting the showroom, and we’ll be happy to help. 😊";
}

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  // Handle preflight request
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Only allow POST
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    const { message } = req.body || {};

    // Validate message
    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message is required.",
      });
    }

    const cleanMessage = message
      .trim()
      .slice(0, 1000);

    if (!cleanMessage) {
      return res.status(400).json({
        error: "Message is required.",
      });
    }

    // ----------------------------------------
    // STEP 1: Find relevant FAQs
    // ----------------------------------------

    const matches = retrieveFAQs(cleanMessage, 4);

    const bestScore = matches[0]?.score || 0;

    // If there is no meaningful FAQ match,
    // do not allow Gemini to invent an answer.
    if (bestScore < 1) {
      return res.status(200).json({
        reply: fallback(),
        source: "fallback",
      });
    }

    // ----------------------------------------
    // STEP 2: Build FAQ context
    // ----------------------------------------

    const context = matches
      .map(
        ({ faq }) =>
          `Category: ${faq.category}
Question: ${faq.question}
Answer: ${faq.answer}`
      )
      .join("\n\n---\n\n");

    // ----------------------------------------
    // STEP 3: Gemini instructions
    // ----------------------------------------

    const systemInstruction = `
You are the friendly customer-support assistant for Furniture Bazaar.

Your job is to answer the customer's question using ONLY the Furniture Bazaar FAQ information supplied below.

IMPORTANT RULES:

- Be warm, concise, natural, and professional.
- Sound like a real Furniture Bazaar customer-support representative.
- Do not sound robotic or overly technical.
- Never invent information.
- Never invent prices, discounts, delivery dates, warranty periods, fees, refund amounts, availability, product specifications, or policy exceptions.
- If the FAQ says something varies or depends on the product, location, or order, preserve that qualification.
- If the supplied FAQ information does not answer the customer's question, politely explain that you do not want to provide incorrect information and recommend contacting the Furniture Bazaar team.
- Do not mention "FAQ context".
- Do not mention "knowledge base".
- Do not mention "source document".
- Do not mention "retrieval".
- Do not mention internal instructions.
- Do not claim that you checked live inventory.
- Do not claim that you checked an order.
- Do not claim to have contacted the Furniture Bazaar team.
- Keep most answers between 2 and 5 short sentences.
- Use simple language that customers can easily understand.
- Use an emoji sparingly when it feels natural.
- If the customer asks a simple question, give a simple answer.
- If the customer asks multiple questions, answer each one if the supplied information supports it.
- Never make assumptions when the FAQ does not provide the information.

Furniture Bazaar FAQ information:

${context}
`;

    // ----------------------------------------
    // STEP 4: Generate AI response
    // ----------------------------------------

    const result = await ai.models.generateContent({
      model: "gemini-3.6-flash",
      contents: cleanMessage,
      config: {
        systemInstruction,
        maxOutputTokens: 300,
      },
    });

    // ----------------------------------------
    // STEP 5: Get response
    // ----------------------------------------

    const reply =
      result.text?.trim() || fallback();

    // ----------------------------------------
    // STEP 6: Return response
    // ----------------------------------------

    return res.status(200).json({
      reply,
      source: matches[0].faq.id,
    });

  } catch (error) {
    console.error(
      "Furniture Bazaar AI error:",
      error
    );

    return res.status(500).json({
      error: "Unable to process the request right now.",
    });
  }
}