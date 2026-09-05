// ============================================================
// RevenueGuard AI — Gemini AI Client
// ============================================================
// This module wraps the Google Gemini API for two specific jobs:
//   1. Root cause classification of failed payments
//   2. Recovery message drafting
//
// WHY @google/genai (not @google-cloud/vertexai):
//   - @google/genai is the newer, simpler SDK from Google
//   - Works with just an API key (no GCP project needed)
//   - Supports structured JSON output natively via responseJsonSchema
//   - The structured output is key: we get typed JSON, not free-form text
//
// PANEL Q: "Why not just use string matching on error codes?"
// ANSWER:  "Error codes alone are ambiguous. 'BAD_REQUEST_ERROR' could mean
//           insufficient funds, expired card, or mandate revoked. The AI looks
//           at the error code, error description, amount, payment method, and
//           retry history together to classify the real root cause. But 
//           critically, the AI only classifies — it never decides the action.
//           The deterministic decision engine handles that."
// ============================================================

import { GoogleGenAI, Type } from '@google/genai';

// Initialize the client with the API key
// The key is stored server-side in .env.local, never exposed to the browser
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

// Model choice: gemini-2.0-flash-001
// WHY: Fast, cheap, good enough for classification. We don't need
// a pro model for this — we're classifying into 9 categories,
// not writing novels. Flash keeps latency low for batch processing.
// NOTE: Using the specific version suffix to avoid deprecation.
const MODEL = 'gemini-3.1-flash-lite';

// ============================================================
// 1. Classification
// ============================================================

// The JSON schema that Gemini must conform its output to.
// This is NOT a prompt — it's a structural constraint.
// Gemini's response.text is guaranteed to be valid JSON matching this.
const CLASSIFICATION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    root_cause: {
      type: Type.STRING,
      description: 'The classified root cause of the payment failure',
      enum: [
        'insufficient_funds',
        'card_expired',
        'card_declined',
        'bank_error',
        'authentication_failed',
        'upi_timeout',
        'mandate_revoked',
        'international_blocked',
        'network_error',
      ],
    },
    confidence: {
      type: Type.NUMBER,
      description: 'Confidence score between 0.0 and 1.0',
    },
    reasoning: {
      type: Type.STRING,
      description:
        'Brief explanation of why this root cause was chosen, referencing the specific signals in the payment data',
    },
    retriable: {
      type: Type.BOOLEAN,
      description:
        'Whether this payment failure is likely to succeed on retry (true) or requires customer action (false)',
    },
  },
  propertyOrdering: ['root_cause', 'confidence', 'reasoning', 'retriable'],
};

export interface ClassificationResult {
  root_cause: string;
  confidence: number;
  reasoning: string;
  retriable: boolean;
}

interface PaymentDataForClassification {
  error_code: string;
  error_description: string;
  error_reason: string;
  amount: number; // paise
  method: string;
  card_network?: string | null;
  card_issuer?: string | null;
  is_recurring: boolean;
  attempt_count: number;
}

export async function classifyPaymentFailure(
  payment: PaymentDataForClassification
): Promise<ClassificationResult> {
  const amountRupees = (payment.amount / 100).toFixed(2);

  const prompt = `You are a payment failure analyst for an Indian payment gateway (like Razorpay).

Analyze this failed payment and classify its root cause:

PAYMENT DATA:
- Error Code: ${payment.error_code}
- Error Description: ${payment.error_description}
- Error Reason: ${payment.error_reason}
- Amount: ₹${amountRupees}
- Payment Method: ${payment.method}
${payment.card_network ? `- Card Network: ${payment.card_network}` : ''}
${payment.card_issuer ? `- Card Issuer: ${payment.card_issuer}` : ''}
- Is Recurring Payment: ${payment.is_recurring}
- Previous Attempt Count: ${payment.attempt_count}

Classify into exactly one root cause. Consider:
- The error code and description are the primary signals
- Amount context matters (micro-payments fail differently than large ones)
- Recurring payments have different failure patterns
- Card network and issuer can indicate systemic issues

Be calibrated with your confidence score:
- 0.9+ only if the error description is unambiguous
- 0.7-0.9 for strong but not definitive signals
- 0.5-0.7 for ambiguous cases
- Below 0.5 if genuinely uncertain`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: CLASSIFICATION_SCHEMA,
      temperature: 0.1, // Low temperature for consistent classification
    },
  });

  const result: ClassificationResult = JSON.parse(response.text!);

  // Clamp confidence to [0, 1] range (safety check)
  result.confidence = Math.max(0, Math.min(1, result.confidence));

  return result;
}

// ============================================================
// 2. Recovery Message Drafting
// ============================================================

export interface MessageDraftInput {
  customer_name: string;
  amount: number; // paise
  root_cause: string;
  attempt_number: number;
  method: string;
  is_recurring: boolean;
  has_payment_link?: boolean;
}

export async function draftRecoveryMessage(
  input: MessageDraftInput
): Promise<string> {
  const amountRupees = (input.amount / 100).toFixed(2);

  // Tone escalation based on attempt number
  // Attempt 1: gentle, helpful
  // Attempt 2: concerned, offering alternatives
  // Attempt 3: firm but respectful, urgency
  const toneGuide =
    input.attempt_number <= 1
      ? 'Be warm, helpful, and non-accusatory. This is a first notification.'
      : input.attempt_number === 2
        ? 'Be concerned and solution-oriented. Offer clear alternatives. This is a follow-up.'
        : 'Be respectful but convey urgency. This is a final notice before escalation.';

  const linkInstruction = input.has_payment_link
    ? 'Reference the payment link using the exact token "[Payment Link]" where the URL should appear.'
    : 'Do NOT mention any payment link or URL. Ask the customer to reply or confirm payment details.';

  const prompt = `You are writing a recovery message for a failed payment on behalf of a business using Razorpay.

CONTEXT:
- Customer Name: ${input.customer_name}
- Amount: ₹${amountRupees}
- Failure Reason: ${input.root_cause.replace(/_/g, ' ')}
- Payment Method: ${input.method}
- Recurring Payment: ${input.is_recurring ? 'Yes (subscription)' : 'No'}
- Attempt Number: ${input.attempt_number}

TONE: ${toneGuide}

RULES:
1. Keep it under 150 words
2. Never mention the exact technical error code
3. Use soft language for the failure reason (e.g., "payment couldn't be processed" instead of "card declined")
4. Include a clear call-to-action
5. ${linkInstruction}
6. Sign off professionally

Write the message as a complete email/SMS body, ready to send.`;

  const response = await ai.models.generateContent({
    model: MODEL,
    contents: prompt,
    config: {
      temperature: 0.7, // Higher temperature for natural-sounding messages
    },
  });

  return response.text!;
}
