import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ── Preços server-side (espelho do pix/index.ts) ──
const PIX_PRODUCTS: Record<string, { priceCents: number; name: string }> = {
  seguro:  { priceCents: 1948, name: "Seguro Prestamista - SuperSim" },
  up1:     { priceCents: 2482, name: "IOF - Imposto sobre Operações Financeiras" },
  up2:     { priceCents: 2391, name: "Taxa de Verificação de IOF" },
  up3:     { priceCents: 1868, name: "Seguro Prestamista - Tarifa de Cadastro" },
  up4:     { priceCents: 1720, name: "TENF - Taxa de Emissão da Nota Fiscal" },
  up5:     { priceCents: 1700, name: "Ativar Conta" },
  up6:     { priceCents: 1702, name: "Taxa de Registro do Contrato" },
  up7:     { priceCents: 1406, name: "Taxa - Limite Adicional de R$20.000" },
  up8:     { priceCents: 1406, name: "Taxa de Processamento" },
  up9:     { priceCents: 1199, name: "Aplicativo SuperSim" },
  up10:    { priceCents: 1692, name: "TAC - Taxa de Abertura de Crédito" },
  up11:    { priceCents: 1953, name: "Taxa de Consultoria Financeira" },
  up12:    { priceCents: 3192, name: "Taxa de Processamento Administrativo" },
  // ── DOWNSELL (50% OFF) ──
  seguro_ds: { priceCents: 645,  name: "Seguro Prestamista - SuperSim" },
  up1_ds:    { priceCents: 1241, name: "IOF - Imposto sobre Operações Financeiras" },
  up2_ds:    { priceCents: 1196, name: "Taxa de Verificação de IOF" },
  up3_ds:    { priceCents: 934,  name: "Seguro Prestamista - Tarifa de Cadastro" },
  up4_ds:    { priceCents: 860,  name: "TENF - Taxa de Emissão da Nota Fiscal" },
  up5_ds:    { priceCents: 850,  name: "Ativar Conta" },
  up6_ds:    { priceCents: 850,  name: "Taxa de Registro do Contrato" },
  up7_ds:    { priceCents: 703,  name: "Taxa - Limite Adicional de R$20.000" },
  up8_ds:    { priceCents: 703,  name: "Taxa de Processamento" },
  up9_ds:    { priceCents: 600,  name: "Aplicativo SuperSim" },
  up10_ds:   { priceCents: 846,  name: "TAC - Taxa de Abertura de Crédito" },
  up11_ds:   { priceCents: 977,  name: "Taxa de Consultoria Financeira" },
  up12_ds:   { priceCents: 1596, name: "Taxa de Processamento Administrativo" },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key, x-webhook-secret",
};

Deno.serve(async (req: Request) => {
  // ── CORS preflight ──
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const event = body.event || body.type || "unknown";
    const txnId = body.transactionId || body.data?.transactionId || body.id || "unknown";
    const status = body.status || body.data?.status || "unknown";

    console.log(`[WEBHOOK] event=${event} txn=${txnId} status=${status}`);
    console.log(`[WEBHOOK] Full payload:`, JSON.stringify(body));

    // ── Registra pedido na Utmify quando pagamento é confirmado OU quando o Pix é criado (pendente) ──
    const isPaid = event === "transaction.paid" ||
                   event === "sale.paid" ||
                   event === "payment.confirmed" ||
                   status === "paid" ||
                   status === "PAID";

    const isPending = !isPaid && (
                   event === "transaction.created" ||
                   status === "pending" ||
                   status === "PENDING" ||
                   status === "waiting_payment");

    if (isPaid || isPending) {
      const utmifyStatus = isPaid ? "paid" : "waiting_payment";
      console.log(`[WEBHOOK] ${isPaid ? "Payment confirmed" : "Pending transaction created"} for txn=${txnId}. Registering on Utmify as ${utmifyStatus}...`);

      // Extrair UTMs do webhook da Blackcat — a Blackcat retorna UTMs no objeto "utm" na raiz do payload
      const utm = body.utm || body.data?.utm || {};
      const metadata = body.metadata || body.data?.metadata || {};
      const customer = body.customer || body.data?.customer || {};

      // ── Buscar a transação salva no momento da criação (pix/index.ts) — fonte confiável de UTM
      // e produto, já que não dá pra garantir que a Blackcat ecoa esses dados de volta no webhook ──
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      let storedTx: Record<string, any> | null = null;
      if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && txnId !== "unknown") {
        try {
          const dbRes = await fetch(
            `${SUPABASE_URL}/rest/v1/transactions?txn_id=eq.${encodeURIComponent(txnId)}&select=*`,
            {
              headers: {
                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
              },
            }
          );
          const rows = await dbRes.json();
          storedTx = Array.isArray(rows) && rows[0] ? rows[0] : null;
        } catch (dbErr) {
          console.error("[WEBHOOK] Failed to fetch stored transaction:", dbErr);
        }
      }
      const storedUtms = storedTx?.metadata || {};

      // Identificar produto: prioriza o up_key salvo na criação (confiável), cai pro valor se não achar
      const amountCents = body.amount || body.data?.amount || 0;
      let matchedProduct = PIX_PRODUCTS["seguro"];
      if (storedTx?.up_key && PIX_PRODUCTS[storedTx.up_key]) {
        matchedProduct = PIX_PRODUCTS[storedTx.up_key];
      } else {
        for (const [key, prod] of Object.entries(PIX_PRODUCTS)) {
          if (prod.priceCents === amountCents) {
            matchedProduct = prod;
            break;
          }
        }
      }

      // Montar trackingParameters — prioriza o que foi salvo na criação, cai pro que a Blackcat mandar
      const trackingParameters = {
        src: storedUtms.src || utm.src || metadata.src || null,
        sck: storedUtms.sck || utm.sck || metadata.sck || null,
        utm_source: storedUtms.utm_source || utm.utm_source || metadata.utm_source || null,
        utm_medium: storedUtms.utm_medium || utm.utm_medium || metadata.utm_medium || null,
        utm_campaign: storedUtms.utm_campaign || utm.utm_campaign || metadata.utm_campaign || null,
        utm_content: storedUtms.utm_content || utm.utm_content || metadata.utm_content || null,
        utm_term: storedUtms.utm_term || utm.utm_term || metadata.utm_term || null,
      };

      // Registrar o pedido na Utmify
      const UTMIFY_API_TOKEN = Deno.env.get("UTMIFY_API_TOKEN");
      if (UTMIFY_API_TOKEN) {
        try {
          const now = new Date();
          const utmifyDate = now.toISOString().replace("T", " ").substring(0, 19);
          // createdAt deve refletir a criação real da transação (não o momento deste evento) —
          // sem isso, o evento de pagamento sobrescreveria a data de criação já registrada no pedido pendente
          const createdAtSource = body.createdAt || body.data?.createdAt || body.timestamp || utmifyDate;
          const createdAtDate = String(createdAtSource).replace("T", " ").substring(0, 19);

          const utmifyPayload = {
            orderId: txnId,
            platform: "CustomPix",
            paymentMethod: "pix",
            status: utmifyStatus,
            createdAt: createdAtDate,
            approvedDate: isPaid ? utmifyDate : null,
            customer: {
              name: customer.name || metadata.customerName || storedTx?.customer_name || "Cliente",
              email: customer.email || metadata.customerEmail || storedTx?.customer_email || "",
              phone: customer.phone || metadata.customerPhone || storedTx?.customer_phone || "",
              document: customer.document?.number || metadata.customerDocument || storedTx?.customer_cpf || "",
            },
            products: [
              {
                id: matchedProduct.name,
                name: matchedProduct.name,
                planId: matchedProduct.name,
                planName: matchedProduct.name,
                quantity: 1,
                priceInCents: matchedProduct.priceCents,
              },
            ],
            trackingParameters,
            commission: {
              totalPriceInCents: matchedProduct.priceCents,
              gatewayFeeInCents: 0,
              userCommissionInCents: matchedProduct.priceCents,
            },
            isTest: false,
          };

          console.log(`[WEBHOOK] Sending to Utmify:`, JSON.stringify(utmifyPayload));

          const utmifyRes = await fetch("https://api.utmify.com.br/api-credentials/orders", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-token": UTMIFY_API_TOKEN,
            },
            body: JSON.stringify(utmifyPayload),
          });

          const utmifyResult = await utmifyRes.json();
          console.log(`[WEBHOOK] Utmify response status=${utmifyRes.status}:`, JSON.stringify(utmifyResult));

          if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY && txnId !== "unknown") {
            try {
              await fetch(`${SUPABASE_URL}/rest/v1/transactions?txn_id=eq.${encodeURIComponent(txnId)}`, {
                method: "PATCH",
                headers: {
                  "Content-Type": "application/json",
                  "apikey": SUPABASE_SERVICE_ROLE_KEY,
                  "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                },
                body: JSON.stringify({
                  status: isPaid ? "PAID" : "PENDING",
                  paid_at: isPaid ? utmifyDate : null,
                }),
              });
            } catch (dbErr) {
              console.error("[WEBHOOK] Failed to update transaction status:", dbErr);
            }
          }
        } catch (utmifyErr) {
          // Não bloqueia o webhook por falha na Utmify
          console.error("[WEBHOOK] Utmify registration failed:", utmifyErr);
        }
      } else {
        console.warn("[WEBHOOK] UTMIFY_API_TOKEN not configured — skipping Utmify registration");
      }
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("[WEBHOOK] Error:", err);
    return new Response(JSON.stringify({ received: false, error: "Parse error" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
