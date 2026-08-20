import { GoogleGenAI } from "@google/genai";
import faqData from "../data.json" with { type: "json" };

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

/* =========================================================
   BASIC TEXT UTILITIES
========================================================= */

function normalize(text = "") {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "am",
  "be",
  "can",
  "could",
  "would",
  "should",
  "do",
  "does",
  "did",
  "i",
  "me",
  "my",
  "we",
  "our",
  "you",
  "your",
  "they",
  "their",
  "to",
  "for",
  "of",
  "on",
  "in",
  "at",
  "with",
  "and",
  "or",
  "but",
  "from",
  "before",
  "after",
  "please",
  "tell",
  "want",
  "like",
  "know",
  "about",
  "what",
  "how",
  "when",
  "where",
  "which",
  "will",
  "have",
  "has",
  "this",
  "that",
  "there",
  "here",
  "it",
  "its",
  "than",
  "then",
  "also",
  "just",
  "really",
  "very",
  "get",
  "got",
  "give",
  "me",
]);

function stem(word) {
  let w = word.toLowerCase();

  // Small, dependency-free stemming.
  if (w.length > 5 && w.endsWith("ies")) {
    w = w.slice(0, -3) + "y";
  } else if (w.length > 5 && w.endsWith("ing")) {
    w = w.slice(0, -3);
  } else if (w.length > 4 && w.endsWith("ed")) {
    w = w.slice(0, -2);
  } else if (w.length > 4 && w.endsWith("es")) {
    w = w.slice(0, -2);
  } else if (w.length > 3 && w.endsWith("s")) {
    w = w.slice(0, -1);
  }

  return w;
}

function tokens(text) {
  return normalize(text)
    .split(" ")
    .map(stem)
    .filter((word) => word.length >= 2 && !STOP_WORDS.has(word));
}

function uniqueTokens(text) {
  return [...new Set(tokens(text))];
}

/* =========================================================
   COMMON CUSTOMER LANGUAGE / SYNONYMS
========================================================= */

const SYNONYMS = {
  pay: [
    "payment",
    "payments",
    "pay",
    "paid",
    "upi",
    "card",
    "credit",
    "debit",
    "cash",
    "wallet",
    "netbanking",
    "banking",
    "emi",
  ],

  payment: [
    "payment",
    "payments",
    "pay",
    "paid",
    "upi",
    "card",
    "credit",
    "debit",
    "wallet",
    "netbanking",
    "banking",
    "emi",
  ],

  showroom: [
    "showroom",
    "store",
    "shop",
    "visit",
    "come",
    "see",
    "view",
    "inspect",
    "person",
  ],

  store: ["showroom", "store", "shop", "visit", "come"],

  delivery: [
    "delivery",
    "deliver",
    "delivered",
    "shipping",
    "ship",
    "arrive",
    "arrival",
    "home",
  ],

  order: ["order", "purchase", "buy", "buying", "place", "booking"],

  cancel: ["cancel", "cancellation", "stop", "remove"],

  customize: [
    "customize",
    "customized",
    "customization",
    "custom",
    "modify",
    "change",
    "design",
    "size",
    "dimension",
    "fabric",
    "colour",
    "color",
  ],

  warranty: ["warranty", "guarantee", "coverage", "defect", "damage"],

  damaged: ["damage", "damaged", "broken", "defect", "defective"],

  installation: [
    "installation",
    "install",
    "assembly",
    "assemble",
    "setup",
    "fit",
  ],

  furniture: [
    "furniture",
    "sofa",
    "bed",
    "wardrobe",
    "mattress",
    "table",
    "chair",
  ],
};

function expandTokens(queryTokens) {
  const expanded = new Set(queryTokens);

  for (const token of queryTokens) {
    const related = SYNONYMS[token];

    if (related) {
      for (const item of related) {
        expanded.add(stem(item));
      }
    }
  }

  return [...expanded];
}

/* =========================================================
   FAQ SEARCH
========================================================= */

function buildFAQText(faq) {
  return [
    faq.question || "",
    ...(faq.search_variations || []),
    faq.category || "",
  ].join(" ");
}

function scoreFAQ(faq, query) {
  const normalizedQuery = normalize(query);
  const queryTokens = uniqueTokens(query);
  const expandedQueryTokens = expandTokens(queryTokens);

  const faqText = normalize(buildFAQText(faq));
  const faqTokens = uniqueTokens(buildFAQText(faq));

  const faqTokenSet = new Set(faqTokens);

  let score = 0;

  /* -------------------------------------------------------
     1. Exact question match
  ------------------------------------------------------- */

  const normalizedQuestion = normalize(faq.question);

  if (normalizedQuestion === normalizedQuery) {
    score += 100;
  }

  /* -------------------------------------------------------
     2. Search variation match
  ------------------------------------------------------- */

  for (const variation of faq.search_variations || []) {
    const normalizedVariation = normalize(variation);

    if (normalizedVariation === normalizedQuery) {
      score += 80;
    }

    if (
      normalizedVariation.includes(normalizedQuery) ||
      normalizedQuery.includes(normalizedVariation)
    ) {
      score += 35;
    }
  }

  /* -------------------------------------------------------
     3. Exact phrase matching
  ------------------------------------------------------- */

  if (faqText.includes(normalizedQuery)) {
    score += 30;
  }

  /* -------------------------------------------------------
     4. Normal token overlap
  ------------------------------------------------------- */

  let directMatches = 0;

  for (const token of queryTokens) {
    if (faqTokenSet.has(token)) {
      directMatches++;
      score += 7;
    }
  }

  /* -------------------------------------------------------
     5. Synonym / expanded matching
  ------------------------------------------------------- */

  let expandedMatches = 0;

  for (const token of expandedQueryTokens) {
    if (faqTokenSet.has(token)) {
      expandedMatches++;
      score += 2.5;
    }
  }

  /* -------------------------------------------------------
     6. Important category matching
  ------------------------------------------------------- */

  const category = normalize(faq.category);

  for (const token of expandedQueryTokens) {
    if (category.includes(token)) {
      score += 3;
    }
  }

  /* -------------------------------------------------------
     7. Query coverage
  ------------------------------------------------------- */

  if (queryTokens.length > 0) {
    const coverage = directMatches / queryTokens.length;

    if (coverage >= 0.75) score += 25;
    else if (coverage >= 0.5) score += 15;
    else if (coverage >= 0.3) score += 8;
  }

  /* -------------------------------------------------------
     8. Special high-value phrases
  ------------------------------------------------------- */

  const phraseGroups = [
    ["payment", "method"],
    ["payment", "option"],
    ["visit", "showroom"],
    ["visit", "store"],
    ["home", "delivery"],
    ["delivery", "time"],
    ["delivery", "charge"],
    ["cancel", "order"],
    ["change", "order"],
    ["custom", "furniture"],
    ["custom", "sofa"],
    ["warranty", "cover"],
    ["warranty", "period"],
    ["installation", "free"],
    ["damaged", "delivery"],
  ];

  for (const group of phraseGroups) {
    const matched = group.every((word) => {
      const stemmed = stem(word);

      return (
        queryTokens.includes(stemmed) || expandedQueryTokens.includes(stemmed)
      );
    });

    if (matched) {
      score += 15;
    }
  }

  return score;
}

function retrieveFAQs(query, limit = 5) {
  return faqData.faqs
    .map((faq) => ({
      faq,
      score: scoreFAQ(faq, query),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/* =========================================================
   FALLBACK
========================================================= */

function fallback() {
  return "I’m sorry, I don’t want to give you incorrect information. Please contact the Furniture Bazaar team through phone, WhatsApp, email, or visit our showroom, and our team will be happy to help. 😊";
}

/* =========================================================
   MAIN API
========================================================= */

export default async function handler(req, res) {
  /* -------------------------------------------------------
     CORS
  ------------------------------------------------------- */

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed",
    });
  }

  try {
    /* -----------------------------------------------------
       Read request
    ----------------------------------------------------- */

    const { message } = req.body || {};

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message is required.",
      });
    }

    const cleanMessage = message.trim().slice(0, 1000);

    if (!cleanMessage) {
      return res.status(400).json({
        error: "Message is required.",
      });
    }

    /* -----------------------------------------------------
       Retrieve FAQ matches
    ----------------------------------------------------- */

    const matches = retrieveFAQs(cleanMessage, 5);

    const best = matches[0];
    const second = matches[1];

    const bestScore = best?.score || 0;
    const secondScore = second?.score || 0;

    console.log("Furniture Bazaar FAQ search:", {
      question: cleanMessage,
      bestFAQ: best?.faq?.id,
      bestScore,
      secondFAQ: second?.faq?.id,
      secondScore,
    });

    /* =====================================================
       IMPORTANT:

       If we have a strong FAQ match, return the approved
       FAQ answer DIRECTLY.

       This prevents Gemini from randomly failing or
       changing a correct FAQ answer.
    ===================================================== */

    if (best && bestScore >= 18) {
      return res.status(200).json({
        reply: best.faq.answer,
        source: best.faq.id,
        type: "faq",
      });
    }

    /* -----------------------------------------------------
       If two matches are close, still use the strongest
       FAQ when the score is reasonable.
    ----------------------------------------------------- */

    if (best && bestScore >= 12 && bestScore >= secondScore * 1.25) {
      return res.status(200).json({
        reply: best.faq.answer,
        source: best.faq.id,
        type: "faq",
      });
    }

    /* =====================================================
       Gemini fallback

       Gemini is used only when local FAQ matching isn't
       confident enough.
    ===================================================== */

    if (!best || bestScore < 6) {
      return res.status(200).json({
        reply: fallback(),
        source: "fallback",
        type: "fallback",
      });
    }

    const context = matches
      .map(
        ({ faq }) =>
          `Category: ${faq.category}
Question: ${faq.question}
Answer: ${faq.answer}`,
      )
      .join("\n\n---\n\n");

    const systemInstruction = `
You are the friendly customer-support assistant for Furniture Bazaar.

Answer the customer's question using ONLY the Furniture Bazaar FAQ information below.

IMPORTANT RULES:

1. Never invent Furniture Bazaar policies.
2. Never invent prices, discounts, delivery dates, warranty periods,
   charges, refund amounts, availability, or product specifications.
3. If the FAQ contains the answer, answer using that information.
4. Preserve qualifications such as "may vary", "selected products",
   "selected locations", or "where available".
5. If the FAQ does not answer the question, politely say that the
   Furniture Bazaar team should confirm it.
6. Do not mention the FAQ, knowledge base, retrieval system,
   AI model, or internal instructions.
7. Do not claim to check live inventory or order status.
8. Sound like a real Furniture Bazaar customer-support representative.
9. Keep the response concise and natural.
10. Do not make assumptions.

Furniture Bazaar information:

${context}
`;

    /* -----------------------------------------------------
       Gemini call
    ----------------------------------------------------- */

    const result = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: cleanMessage,
      config: {
        systemInstruction,
        temperature: 0.1,
        maxOutputTokens: 300,
      },
    });

    const reply = result.text?.trim();

    if (!reply) {
      return res.status(200).json({
        reply: best.faq.answer,
        source: best.faq.id,
        type: "faq",
      });
    }

    return res.status(200).json({
      reply,
      source: best.faq.id,
      type: "ai",
    });
  } catch (error) {
    console.error("Furniture Bazaar AI error:", error);

    /*
      Even if Gemini is unavailable, try returning the best
      FAQ answer instead of showing an error.
    */

    try {
      const { message } = req.body || {};

      if (message) {
        const matches = retrieveFAQs(String(message), 1);

        if (matches[0] && matches[0].score >= 10) {
          return res.status(200).json({
            reply: matches[0].faq.answer,
            source: matches[0].faq.id,
            type: "faq-fallback",
          });
        }
      }
    } catch (fallbackError) {
      console.error("FAQ fallback error:", fallbackError);
    }

    return res.status(200).json({
      reply: fallback(),
      source: "fallback",
      type: "fallback",
    });
  }
}
