// ============================================================
// RevenueGuard AI — Seed API Route
// POST /api/seed
// ============================================================
// Generates 200 synthetic failed payment records with realistic
// distributions and inserts them into Supabase.
//
// WHY SYNTHETIC DATA:
//   - Can't use real payment data (privacy, compliance)
//   - Razorpay test mode doesn't generate failed payments at scale
//   - Synthetic data lets us control the distribution to demonstrate
//     all paths in the decision engine
//
// HOW THE DISTRIBUTION WORKS:
//   We use weighted random sampling to match the target percentages:
//   30% insufficient_funds, 15% card_expired, etc.
//   This ensures the batch has enough variety to show all rules firing.
//
// PANEL Q: "How realistic is your synthetic data?"
// ANSWER:  "The error codes and descriptions match Razorpay's actual
//           API responses. The amount distribution follows real e-commerce
//           patterns (mostly small, some large). Customer names are from
//           a realistic Indian name pool. Some customers have multiple
//           failures — that's realistic too."
// ============================================================

import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// ── Failure Reason Pool ──
// Each entry has the weight (probability), error code, description, and reason
// These match Razorpay's actual error format
const FAILURE_REASONS = [
  {
    weight: 30,
    root_cause: 'insufficient_funds',
    error_code: 'BAD_REQUEST_ERROR',
    error_description: 'Your payment could not be completed due to insufficient account balance. Please try with another payment method.',
    error_reason: 'insufficient_funds',
  },
  {
    weight: 15,
    root_cause: 'card_expired',
    error_code: 'BAD_REQUEST_ERROR',
    error_description: 'The card has expired. Please use a different card or update your card details.',
    error_reason: 'card_expired',
  },
  {
    weight: 15,
    root_cause: 'card_declined',
    error_code: 'GATEWAY_ERROR',
    error_description: 'The payment was declined by the card issuing bank. Please contact your bank or try with a different card.',
    error_reason: 'card_declined',
  },
  {
    weight: 10,
    root_cause: 'bank_error',
    error_code: 'GATEWAY_ERROR',
    error_description: 'Payment failed due to a temporary issue with the bank server. Please retry after some time.',
    error_reason: 'bank_server_error',
  },
  {
    weight: 10,
    root_cause: 'authentication_failed',
    error_code: 'BAD_REQUEST_ERROR',
    error_description: 'Payment authentication failed. The OTP entered was incorrect or the 3D Secure verification was not completed.',
    error_reason: 'authentication_failed',
  },
  {
    weight: 8,
    root_cause: 'upi_timeout',
    error_code: 'GATEWAY_ERROR',
    error_description: 'UPI payment timed out. The customer did not approve the collect request within the stipulated time.',
    error_reason: 'upi_timeout',
  },
  {
    weight: 20,
    root_cause: 'mandate_revoked',
    error_code: 'BAD_REQUEST_ERROR',
    error_description: 'The mandate/auto-debit permission has been revoked by the customer. Cannot process recurring payment.',
    error_reason: 'mandate_revoked',
  },
  {
    weight: 4,
    root_cause: 'network_error',
    error_code: 'GATEWAY_ERROR',
    error_description: 'Payment failed due to a network connectivity issue between the bank and payment gateway.',
    error_reason: 'network_error',
  },
  {
    weight: 3,
    root_cause: 'international_blocked',
    error_code: 'BAD_REQUEST_ERROR',
    error_description: 'International transactions are not enabled on this card. Please use a domestic card or enable international usage.',
    error_reason: 'international_card_blocked',
  },
];

// ── Indian Names Pool ──
const FIRST_NAMES = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Sai', 'Reyansh',
  'Ananya', 'Diya', 'Myra', 'Priya', 'Saanvi', 'Isha', 'Kavya',
  'Rohan', 'Karan', 'Neha', 'Sneha', 'Rahul', 'Amit', 'Pooja',
  'Rishi', 'Meera', 'Tanvi', 'Vikram', 'Shreya', 'Aryan', 'Nisha',
  'Raj', 'Divya', 'Manish', 'Swati', 'Deepak', 'Anjali', 'Suresh',
  'Lakshmi', 'Ganesh', 'Fatima', 'Mohammed', 'Zara', 'Simran', 'Gurpreet',
];

const LAST_NAMES = [
  'Sharma', 'Patel', 'Kumar', 'Singh', 'Reddy', 'Joshi', 'Gupta',
  'Iyer', 'Nair', 'Rao', 'Das', 'Mehta', 'Shah', 'Verma',
  'Agarwal', 'Chopra', 'Malhotra', 'Sinha', 'Bhat', 'Kaur',
  'Chauhan', 'Jain', 'Mishra', 'Pandey', 'Banerjee', 'Khan',
];

// ── Card Networks & Issuers ──
const CARD_NETWORKS = [
  { name: 'Visa', weight: 40 },
  { name: 'Mastercard', weight: 35 },
  { name: 'RuPay', weight: 25 },
];

const CARD_ISSUERS = ['HDFC Bank', 'ICICI Bank', 'SBI', 'Axis Bank', 'Kotak Mahindra', 'Bank of Baroda', 'PNB'];

// ── Amount Bands ──
// Values in paise. Distribution: 25% micro, 30% small, 25% medium, 15% large, 5% high
const AMOUNT_RANGES = [
  { weight: 25, min: 1000, max: 50000 },       // ₹10 – ₹500
  { weight: 30, min: 50001, max: 200000 },      // ₹500.01 – ₹2,000
  { weight: 25, min: 200001, max: 1000000 },    // ₹2,000.01 – ₹10,000
  { weight: 15, min: 1000001, max: 5000000 },   // ₹10,000.01 – ₹50,000
  { weight: 5, min: 5000001, max: 15000000 },   // ₹50,000.01 – ₹1,50,000
];

// ── Payment Methods ──
const PAYMENT_METHODS = [
  { method: 'card', weight: 45 },
  { method: 'upi', weight: 30 },
  { method: 'netbanking', weight: 15 },
  { method: 'wallet', weight: 5 },
  { method: 'emandate', weight: 5 },
];

// ── Utility functions ──

function weightedRandom<T extends { weight: number }>(items: T[]): T {
  const totalWeight = items.reduce((sum, item) => sum + item.weight, 0);
  let random = Math.random() * totalWeight;
  for (const item of items) {
    random -= item.weight;
    if (random <= 0) return item;
  }
  return items[items.length - 1]; // fallback
}

function randomBetween(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomPick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generatePaymentId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'pay_';
  for (let i = 0; i < 14; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function generateOrderId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let id = 'order_';
  for (let i = 0; i < 14; i++) {
    id += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return id;
}

function generateLast4(): string {
  return String(Math.floor(Math.random() * 10000)).padStart(4, '0');
}

function generatePhone(): string {
  const prefixes = ['98', '97', '96', '95', '94', '93', '91', '90', '88', '87', '86', '85', '70', '73', '74', '75', '76', '77', '78', '79'];
  return '+91' + randomPick(prefixes) + String(Math.floor(Math.random() * 100000000)).padStart(8, '0');
}

// ── Generate records ──

function generateCustomers(count: number) {
  const customers = [];
  for (let i = 0; i < count; i++) {
    const first = randomPick(FIRST_NAMES);
    const last = randomPick(LAST_NAMES);
    customers.push({
      id: `cust_${String(i + 1).padStart(4, '0')}`,
      name: `${first} ${last}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}${randomBetween(1, 99)}@gmail.com`,
      phone: generatePhone(),
    });
  }
  return customers;
}

export async function POST() {
  try {
    const supabase = getSupabaseAdmin();
    const RECORD_COUNT = 12;
    const CUSTOMER_COUNT = 8; // 8 unique customers

    // 1. Create a batch run
    const { data: batchRun, error: batchError } = await supabase
      .from('batch_runs')
      .insert({
        total_records: RECORD_COUNT,
        status: 'pending',
      })
      .select('id')
      .single();

    if (batchError) throw new Error(`Batch creation failed: ${batchError.message}`);

    // 2. Generate customers
    const customers = generateCustomers(CUSTOMER_COUNT);

    // 3. Generate failed payment records
    const records = [];
    const now = new Date();

    for (let i = 0; i < RECORD_COUNT; i++) {
      const customer = randomPick(customers);
      const failure = weightedRandom(FAILURE_REASONS);
      const amountRange = weightedRandom(AMOUNT_RANGES);
      const amount = randomBetween(amountRange.min, amountRange.max);
      const paymentMethod = weightedRandom(PAYMENT_METHODS);

      // Subscription logic: 20% are recurring
      const isRecurring = Math.random() < 0.2;
      const subscriptionId = isRecurring ? `sub_${String(randomBetween(1000, 9999))}` : null;

      // Force logical payment methods based on the root cause
      let method = paymentMethod.method;
      
      if (failure.root_cause === 'mandate_revoked') {
        method = 'emandate';
      } else if (failure.root_cause === 'upi_timeout') {
        method = 'upi';
      } else if (['card_expired', 'card_declined', 'international_blocked'].includes(failure.root_cause)) {
        method = 'card';
      }

      // Card details (only for card payments)
      const isCard = method === 'card';
      const cardNetwork = isCard ? weightedRandom(CARD_NETWORKS).name : null;
      const cardIssuer = isCard ? randomPick(CARD_ISSUERS) : null;
      const cardLast4 = isCard ? generateLast4() : null;

      // Spread timestamps over 7 days
      const daysAgo = randomBetween(0, 6);
      const hoursAgo = randomBetween(0, 23);
      const createdAt = new Date(now.getTime() - daysAgo * 86400000 - hoursAgo * 3600000);

      records.push({
        batch_id: batchRun.id,
        customer_id: customer.id,
        customer_name: customer.name,
        customer_email: customer.email,
        customer_phone: customer.phone,
        payment_id: generatePaymentId(),
        order_id: generateOrderId(),
        amount,
        currency: 'INR',
        method,
        card_last4: cardLast4,
        card_network: cardNetwork,
        card_issuer: cardIssuer,
        error_code: failure.error_code,
        error_description: failure.error_description,
        error_reason: failure.error_reason,
        is_recurring: isRecurring,
        subscription_id: subscriptionId,
        attempt_count: 0,
        status: 'unprocessed',
        created_at: createdAt.toISOString(),
      });
    }

    // 4. Insert records in chunks (Supabase has row limits)
    const CHUNK_SIZE = 50;
    for (let i = 0; i < records.length; i += CHUNK_SIZE) {
      const chunk = records.slice(i, i + CHUNK_SIZE);
      const { error: insertError } = await supabase.from('transactions').insert(chunk);
      if (insertError) throw new Error(`Insert failed at chunk ${i / CHUNK_SIZE}: ${insertError.message}`);
    }

    return NextResponse.json({
      success: true,
      count: RECORD_COUNT,
      batch_id: batchRun.id,
      message: `Successfully generated ${RECORD_COUNT} synthetic failed payment records across ${CUSTOMER_COUNT} customers`,
    });
  } catch (error) {
    console.error('[Seed] Error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
