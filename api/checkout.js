export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { total, items } = req.body;
  const secretKey = process.env.STRIPE_SECRET_KEY;

  if (!secretKey) {
    return res.status(500).json({ error: 'Clé Stripe manquante' });
  }

  // Construire les line items : offre de base + chaque upsell
  const lineItems = [];

  // Offre de base
  lineItems.push({
    price_data: {
      currency: 'eur',
      product_data: { name: 'Landing Page Basic — Openshore' },
      unit_amount: 47000, // 470€ en centimes
    },
    quantity: 1,
  });

  // Upsells sélectionnés
  if (items && items.length > 0) {
    items.forEach(function(item) {
      lineItems.push({
        price_data: {
          currency: 'eur',
          product_data: { name: item.label },
          unit_amount: item.price * 100,
        },
        quantity: 1,
      });
    });
  }

  // Encoder les line items au format Stripe (x-www-form-urlencoded)
  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', 'https://form.typeform.com/to/O2Hbqwp8');
  params.append('cancel_url', req.headers.origin + '/#pricing');

  lineItems.forEach(function(item, i) {
    params.append('line_items[' + i + '][price_data][currency]', item.price_data.currency);
    params.append('line_items[' + i + '][price_data][product_data][name]', item.price_data.product_data.name);
    params.append('line_items[' + i + '][price_data][unit_amount]', String(item.price_data.unit_amount));
    params.append('line_items[' + i + '][quantity]', String(item.quantity));
  });

  const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + secretKey,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  const session = await response.json();

  if (session.url) {
    return res.status(200).json({ url: session.url });
  } else {
    return res.status(400).json({ error: session.error?.message || 'Erreur Stripe' });
  }
}
