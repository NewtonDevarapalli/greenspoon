const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const SEEDED_EMAILS = [
  'admin@greenspoon.com',
  'owner@greenspoon.com',
  'manager@greenspoon.com',
  'dispatch@greenspoon.com',
  'customer@greenspoon.com',
];

async function main() {
  const rounds = clampInt(process.env.AUTH_PASSWORD_HASH_ROUNDS, 12, 8, 14);
  const overrides = parseOverrides(process.env.SEED_PASSWORD_OVERRIDES_JSON);
  const now = new Date();

  const summary = [];
  for (const email of SEEDED_EMAILS) {
    const user = await prisma.authUser.findUnique({ where: { email } });
    if (!user) {
      summary.push({ email, status: 'missing', password: null });
      continue;
    }

    const nextPassword = overrides[email] || generateStrongPassword();
    const passwordHash = await bcrypt.hash(nextPassword, rounds);

    await prisma.authUser.update({
      where: { email },
      data: {
        passwordHash,
        failedLoginAttempts: 0,
        lockedUntil: null,
        updatedAt: now,
      },
    });

    summary.push({ email, status: 'rotated', password: nextPassword });
  }

  // eslint-disable-next-line no-console
  console.log('Seeded account password rotation summary:');
  for (const row of summary) {
    if (row.status === 'rotated') {
      // eslint-disable-next-line no-console
      console.log(`${row.email} => ${row.password}`);
    } else {
      // eslint-disable-next-line no-console
      console.log(`${row.email} => MISSING`);
    }
  }
}

function parseOverrides(raw) {
  if (!raw || typeof raw !== 'string') {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const next = {};
    for (const [email, password] of Object.entries(parsed)) {
      const normalizedEmail = String(email || '').trim().toLowerCase();
      const normalizedPassword = String(password || '');
      if (normalizedEmail && normalizedPassword.length >= 8) {
        next[normalizedEmail] = normalizedPassword;
      }
    }
    return next;
  } catch {
    return {};
  }
}

function generateStrongPassword() {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*';

  const required = [
    pick(lower),
    pick(upper),
    pick(digits),
    pick(symbols),
  ];
  const all = `${lower}${upper}${digits}${symbols}`;
  for (let i = 0; i < 14; i += 1) {
    required.push(pick(all));
  }

  return shuffle(required).join('');
}

function pick(chars) {
  return chars[crypto.randomInt(0, chars.length)];
}

function shuffle(array) {
  const next = [...array];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(0, i + 1);
    const temp = next[i];
    next[i] = next[j];
    next[j] = temp;
  }
  return next;
}

function clampInt(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  const rounded = Math.floor(numeric);
  return Math.min(Math.max(rounded, min), max);
}

main()
  .catch((error) => {
    // eslint-disable-next-line no-console
    console.error('Seeded password rotation failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
