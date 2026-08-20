# Furniture Bazaar AI FAQ Assistant — Backend

Zero-cost starter backend for the Furniture Bazaar Shopify FAQ assistant.

## Stack

- Vercel Functions
- Google Gemini API free tier
- Local JSON FAQ knowledge base
- No paid database
- No vector database

## 1. Install

```bash
npm install
```

## 2. Add the Gemini API key

In Vercel Project Settings → Environment Variables, add:

```text
GEMINI_API_KEY=YOUR_GEMINI_API_KEY
```

Do NOT put this key in Shopify Custom Liquid or frontend JavaScript.

## 3. Deploy

```bash
npx vercel
```

For production:

```bash
npx vercel --prod
```

## 4. API

POST:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/chat
```

Body:

```json
{
  "message": "Can I customize my sofa?"
}
```

Response:

```json
{
  "reply": "Absolutely! ...",
  "source": "custom_03"
}
```

## Notes

The FAQ JSON was built from the supplied Furniture Bazaar FAQ PDF. The PDF states that its answers are sample answers and should be updated against Furniture Bazaar's actual policies before publishing.

This V1 intentionally uses simple FAQ retrieval rather than a paid vector database.
