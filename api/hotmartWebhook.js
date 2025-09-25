// Variáveis de ambiente necessárias (Vercel → Settings → Environment Variables):
//  - HOTMART_HOTTOK                 -> token do webhook configurado na Hotmart (validação por header X-HOTMART-HOTTOK)
//  - FIREBASE_SERVICE_ACCOUNT       -> JSON do service account (ou base64 do JSON)
//  - FIREBASE_PROJECT_ID            -> projectId do Firebase

const admin = require('firebase-admin');

function initAdmin() {
  if (admin.apps.length) return admin.app();

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT || '{}';
  const svc = raw.trim().startsWith('{')
    ? JSON.parse(raw) // JSON literal
    : JSON.parse(Buffer.from(raw, 'base64').toString('utf8')); // base64

  return admin.initializeApp({
    credential: admin.credential.cert(svc),
    projectId: process.env.FIREBASE_PROJECT_ID,
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  try {
    // 1) Segurança: valida o token do webhook
    const hottok = req.headers['x-hotmart-hottok'];
    if (!hottok || hottok !== process.env.HOTMART_HOTTOK) {
      return res.status(401).json({ ok: false, error: 'Invalid HOTTOK' });
    }

    // 2) Payload
    const payload = req.body || {};
    const data = payload.data || payload;
    const nowISO = new Date().toISOString();

    // 3) Normalização de campos úteis (mantém o payload bruto em raw)
    const doc = {
      provider: 'hotmart',
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      receivedAtISO: nowISO,
      headerHottokValid: true,

      event: payload.event || data.event || data.status || null, // ex.: PURCHASE_APPROVED, REFUNDED...
      status: data.status || null,
      transaction:
        data.purchase?.transaction ||
        data.transaction ||
        data.purchase?.transaction_id ||
        null,

      product: {
        id: data.product?.id ?? data.product?.ucode ?? null,
        name: data.product?.name ?? null,
      },

      buyer: {
        id: data.buyer?.id ?? null,
        name: data.buyer?.name ?? null,
        email: (data.buyer?.email || '').toLowerCase() || null,
        country: data.buyer?.country ?? null,
      },

      amount: Number(
        data.purchase?.value ?? data.price?.value ?? data.value ?? 0
      ) || null,
      currency: data.purchase?.currency ?? data.price?.currency ?? 'BRL',

      payment: {
        method: data.purchase?.payment?.method ?? data.payment?.method ?? null,
        installments:
          data.purchase?.installments ?? data.payment?.installments ?? null,
      },

      occurrenceDate:
        data.purchase?.approved_date ??
        data.purchase?.transaction_date ??
        data.creation_date ??
        null,

      raw: payload,
      version: 1,
    };

    // 4) Persistência no Firestore
    initAdmin();
    const db = admin.firestore();

    const docId =
      doc.transaction || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    await db.collection('hotmartEvents').doc(docId).set(doc, { merge: true });

    // 5) Resposta
    return res.status(200).json({ ok: true, id: docId });
  } catch (err) {
    console.error('HOTMART WEBHOOK ERROR', err);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
};

// Aumenta limite do body se necessário (ex.: payloads maiores)
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};
