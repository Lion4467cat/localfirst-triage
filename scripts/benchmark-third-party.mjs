import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = process.cwd();
const CACHE_DIR = path.join(ROOT, "benchmarks", "external-cache");
const REPORT_PATH = path.join(ROOT, "benchmarks", "third-party-baseline.json");
const REFRESH = process.argv.includes("--refresh");

fs.mkdirSync(CACHE_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// Load both engines WITHOUT modifying any firewall source files
// ---------------------------------------------------------------------------
const { scrubSync: extScrubSync } = await import(
  pathToFileURL(path.join(ROOT, "extension", "sidepanel", "firewall-core.js")).href
);

async function loadWebFirewall() {
  const esbuild = require("esbuild");
  const outFile = path.join(CACHE_DIR, "web-firewall.bundle.mjs");
  await esbuild.build({
    entryPoints: [path.join(ROOT, "src", "firewall", "regexScrubber.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile: outFile,
    logLevel: "silent",
  });
  return import(pathToFileURL(outFile).href);
}

const { scanAndRedactLocal } = await loadWebFirewall();

// ---------------------------------------------------------------------------
// Suite A: ai4privacy/pii-masking-300k (150 English rows)
// ---------------------------------------------------------------------------
const A1_LABELS = new Set([
  "EMAIL",
  "TELEPHONENUM",
  "CREDITCARDNUMBER",
  "SOCIALNUM",
  "SSN",
  "PASSWORD",
  "ACCOUNTNUM",
  "IBAN",
  "IDCARDNUM",
  "DRIVERLICENSENUM",
  "TAXNUM",
  "IP",
  "IPV4",
  "IPV6",
  "STREET",
  "ZIPCODE",
  "BUILDINGNUM",
]);

const A2_LABELS = new Set([
  "GIVENNAME",
  "SURNAME",
  "USERNAME",
  "DATEOFBIRTH",
  "CITY",
  "COMPANYNAME",
]);

async function fetchSuiteA() {
  const cacheFile = path.join(CACHE_DIR, "suite-a-pii.json");
  if (!REFRESH && fs.existsSync(cacheFile)) {
    return JSON.parse(fs.readFileSync(cacheFile, "utf8"));
  }

  const targetCount = 150;
  const rows = [];
  let sourceUrl = "";
  let offset = 0;

  const endpoints = [
    { dataset: "ai4privacy%2Fpii-masking-300k", split: "validation" },
    { dataset: "ai4privacy%2Fpii-masking-300k", split: "train" },
    { dataset: "ai4privacy%2Fpii-masking-200k", split: "train" },
    { dataset: "gretelai%2Fsynthetic_pii_finance_multilingual", split: "test" },
  ];

  for (const ep of endpoints) {
    rows.length = 0;
    offset = 0;
    sourceUrl = "";
    let failed = false;
    while (rows.length < targetCount && offset < 1200) {
      const url = `https://datasets-server.huggingface.co/rows?dataset=${ep.dataset}&config=default&split=${ep.split}&offset=${offset}&length=100`;
      if (!sourceUrl) sourceUrl = url;
      try {
        const res = await fetch(url);
        if (!res.ok) {
          failed = true;
          break;
        }
        const data = await res.json();
        const batch = data?.rows || [];
        if (batch.length === 0) break;
        for (const item of batch) {
          const r = item?.row;
          if (!r) continue;
          const lang = String(r.language || r.locale || "").toLowerCase();
          if (lang && !lang.startsWith("en")) continue;
          const text = r.source_text || r.text || "";
          const mask = Array.isArray(r.privacy_mask) ? r.privacy_mask : [];
          if (text && mask.length > 0) {
            rows.push({
              rowIdx: item.row_idx,
              text,
              privacy_mask: mask.map((m) => ({
                value: String(m.value ?? ""),
                start: m.start,
                end: m.end,
                label: String(m.label || "").toUpperCase(),
              })),
            });
            if (rows.length >= targetCount) break;
          }
        }
        offset += 100;
      } catch {
        failed = true;
        break;
      }
    }
    if (!failed && rows.length >= 50) {
      const payload = {
        dataset: decodeURIComponent(ep.dataset),
        split: ep.split,
        sourceUrl,
        rowRange: `offset=0..${offset}`,
        count: rows.length,
        rows,
      };
      fs.writeFileSync(cacheFile, JSON.stringify(payload, null, 2));
      return payload;
    }
  }
  throw new Error("Failed to fetch Suite A from Hugging Face Datasets Server");
}

// ---------------------------------------------------------------------------
// Suite B: Official Upstream gitleaks/gitleaks config/gitleaks.toml
// ---------------------------------------------------------------------------
function parseGitleaksRules(tomlText) {
  const rules = new Map();
  const blocks = tomlText.split(/\[\[rules\]\]/);
  for (const block of blocks.slice(1)) {
    const idMatch = block.match(/^\s*id\s*=\s*["']([^"']+)["']/m);
    if (!idMatch) continue;
    const regexMatch = block.match(/^\s*regex\s*=\s*'''([\s\S]*?)'''/m) ||
      block.match(/^\s*regex\s*=\s*"((?:[^"\\]|\\.)*)"/m);
    if (!regexMatch) continue;
    rules.set(idMatch[1], regexMatch[1]);
  }
  return rules;
}

function compileGoRegex(pattern) {
  let flags = "";
  let src = pattern;
  if (src.startsWith("(?i)")) {
    flags += "i";
    src = src.slice(4);
  }
  src = src.replace(/\(\?[ims-]+\)/g, "");
  try {
    return new RegExp(src, flags);
  } catch {
    return null;
  }
}

async function fetchSuiteB() {
  const cacheFile = path.join(CACHE_DIR, "gitleaks.toml");
  const url = "https://raw.githubusercontent.com/gitleaks/gitleaks/master/config/gitleaks.toml";
  let tomlText = "";
  if (!REFRESH && fs.existsSync(cacheFile)) {
    tomlText = fs.readFileSync(cacheFile, "utf8");
  } else {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch gitleaks.toml: HTTP ${res.status}`);
    tomlText = await res.text();
    fs.writeFileSync(cacheFile, tomlText);
  }

  const upstreamRules = parseGitleaksRules(tomlText);

  // 42 realistic synthetic vendor secrets wrapped in realistic configs/logs,
  // verified against official upstream gitleaks.toml regexes where applicable.
  const specs = [
    { ruleId: "aws-access-token", category: "AWS Access Key", secret: "AKIA" + "IOSF" + "ODNN" + "7EXA" + "MPLE", wrap: (s) => `AWS_ACCESS_KEY_ID=${s}` },
    { ruleId: "aws-access-token", category: "AWS Temp Key (ASIA)", secret: "ASIA" + "1234" + "5678" + "90AB" + "CDEF", wrap: (s) => `{"awsKey":"${s}"}` },
    { ruleId: "gcp-api-key", category: "GCP / Firebase API Key", secret: "AIza" + "SyD-" + "9KmP" + "2vL5" + "nQ8r" + "T1wZ" + "4xK9" + "mP2v" + "L5nQ" + "8rT", wrap: (s) => `apiKey: "${s}"` },
    { ruleId: "github-pat", category: "GitHub Classic PAT", secret: "ghp_" + "1234" + "5678" + "90ab" + "cdef" + "ghij" + "klmn" + "opqr" + "stuv" + "wxyz", wrap: (s) => `GITHUB_TOKEN=${s}` },
    { ruleId: "github-fine-grained-pat", category: "GitHub Fine-Grained PAT", secret: "gith" + "ub_p" + "at_1" + "1AAA" + "AAA0" + "1234" + "5678" + "9ABC" + "D_ab" + "cdef" + "ghij" + "klmn" + "opqr" + "stuv" + "wxyz" + "0123" + "4567" + "89AB" + "CDEF" + "GH12" + "3456", wrap: (s) => `token=${s}` },
    { ruleId: "github-oauth", category: "GitHub OAuth", secret: "gho_" + "1234" + "5678" + "90ab" + "cdef" + "ghij" + "klmn" + "opqr" + "stuv" + "wxyz", wrap: (s) => `Authorization: Bearer ${s}` },
    { ruleId: "github-app-token", category: "GitHub User-to-Server", secret: "ghu_" + "1234" + "5678" + "90ab" + "cdef" + "ghij" + "klmn" + "opqr" + "stuv" + "wxyz", wrap: (s) => `GH_USER_TOKEN=${s}` },
    { ruleId: "github-refresh-token", category: "GitHub Refresh Token", secret: "ghr_" + "1234" + "5678" + "90ab" + "cdef" + "ghij" + "klmn" + "opqr" + "stuv" + "wxyz", wrap: (s) => `refresh=${s}` },
    { ruleId: "gitlab-pat", category: "GitLab PAT", secret: "glpa" + "t-12" + "3456" + "7890" + "abcd" + "efgh" + "ij", wrap: (s) => `GITLAB_TOKEN=${s}` },
    { ruleId: "stripe-access-token", category: "Stripe Live Secret", secret: "sk_l" + "ive_" + "51N9" + "x8y7" + "z6w5" + "v4u3" + "t2s1" + "r0q9" + "p", wrap: (s) => `STRIPE_SECRET_KEY=${s}` },
    { ruleId: "stripe-access-token", category: "Stripe Restricted Key", secret: "rk_l" + "ive_" + "51N9" + "x8y7" + "z6w5" + "v4u3" + "t2s1" + "r0q9" + "p", wrap: (s) => `{"stripe":"${s}"}` },
    { ruleId: "slack-bot-token", category: "Slack Bot Token", secret: "xoxb" + "-123" + "4567" + "8901" + "2-12" + "3456" + "7890" + "123-" + "aBcD" + "eFgH" + "iJkL" + "mNoP" + "qRsT" + "uVwX", wrap: (s) => `SLACK_BOT_TOKEN=${s}` },
    { ruleId: "slack-user-token", category: "Slack User Token", secret: "xoxp" + "-123" + "4567" + "8901" + "2-12" + "3456" + "7890" + "12-1" + "2345" + "6789" + "012-" + "abcd" + "ef12" + "3456" + "7890" + "abcd" + "ef12" + "3456" + "7890", wrap: (s) => `SLACK_USER=${s}` },
    { ruleId: "openai-api-key", category: "OpenAI Project Key", secret: "sk-p" + "roj-" + "abcd" + "efgh" + "ijkl" + "mnop" + "qrst" + "uvwx" + "yz12" + "3456" + "7890" + "T3Bl" + "bkFJ" + "abcd" + "efgh", wrap: (s) => `OPENAI_API_KEY=${s}` },
    { ruleId: "anthropic-api-key", category: "Anthropic API Key", secret: "sk-a" + "nt-a" + "pi03" + "-abc" + "defg" + "hijk" + "lmno" + "pqrs" + "tuvw" + "xyz1" + "2345" + "6789" + "0-ab" + "cdef" + "12", wrap: (s) => `ANTHROPIC_API_KEY=${s}` },
    { ruleId: "huggingface-access-token", category: "Hugging Face Token", secret: "hf_a" + "BcDe" + "FgHi" + "JkLm" + "NoPq" + "RsTu" + "VwXy" + "Z123" + "4567" + "8", wrap: (s) => `HF_TOKEN=${s}` },
    { ruleId: "twilio-api-key", category: "Twilio API Key", secret: "SK01" + "2345" + "6789" + "abcd" + "ef01" + "2345" + "6789" + "abcd" + "ef", wrap: (s) => `TWILIO_API_KEY=${s}` },
    { ruleId: "sendgrid-api-token", category: "SendGrid API Token", secret: "SG.a" + "bcde" + "fghi" + "jklm" + "nopq" + "rstu" + "v.ab" + "cdef" + "ghij" + "klmn" + "opqr" + "stuv" + "wxyz" + "0123" + "4567" + "89AB" + "CDEF" + "GHI", wrap: (s) => `SENDGRID_API_KEY=${s}` },
    { ruleId: "npm-access-token", category: "npm Access Token", secret: "npm_" + "aBcD" + "eFgH" + "iJkL" + "mNoP" + "qRsT" + "uVwX" + "yZ01" + "2345" + "6789", wrap: (s) => `//registry.npmjs.org/:_authToken=${s}` },
    { ruleId: "pypi-upload-token", category: "PyPI Upload Token", secret: "pypi" + "-AgE" + "IcHl" + "waS5" + "vcmc" + "CJGE" + "yZjI" + "3YjE" + "0LWI" + "4OWY" + "tNDk" + "2MS0" + "5ZDA" + "4", wrap: (s) => `TWINE_PASSWORD=${s}` },
    { ruleId: "jwt", category: "JWT Token", secret: "eyJh" + "bGci" + "OiJI" + "UzI1" + "NiIs" + "InR5" + "cCI6" + "IkpX" + "VCJ9" + ".eyJ" + "zdWI" + "iOiI" + "xMjM" + "0NTY" + "3ODk" + "wIn0" + ".doz" + "jgNr" + "yP4J" + "3jVm" + "NHl0" + "w5N_" + "XgL0" + "n3I9" + "PlFU" + "P0TH" + "sR8U", wrap: (s) => `token=${s}` },
    { ruleId: "private-key", category: "PEM RSA Private Key", secret: "----" + "-BEG" + "IN R" + "SA P" + "RIVA" + "TE K" + "EY--" + "---\n" + "MIIE" + "owIB" + "AAKC" + "AQEA" + "7V2t" + "estK" + "eyDa" + "ta99" + "\n---" + "--EN" + "D RS" + "A PR" + "IVAT" + "E KE" + "Y---" + "--", wrap: (s) => `cert:\n${s}` },
    { ruleId: "private-key", category: "PEM EC Private Key", secret: "----" + "-BEG" + "IN E" + "C PR" + "IVAT" + "E KE" + "Y---" + "--\nM" + "HcCA" + "QEEI" + "Exam" + "pleP" + "riva" + "teKe" + "yDat" + "a\n--" + "---E" + "ND E" + "C PR" + "IVAT" + "E KE" + "Y---" + "--", wrap: (s) => s },
    { ruleId: "shopify-access-token", category: "Shopify Access Token", secret: "shpa" + "t_01" + "2345" + "6789" + "abcd" + "ef01" + "2345" + "6789" + "abcd" + "ef", wrap: (s) => `SHOPIFY_TOKEN=${s}` },
    { ruleId: "discord-api-token", category: "Discord / Bot Secret", secret: "MTA1" + "MjM0" + "NTY3" + "ODkw" + "MTIz" + "NDU2" + ".Gab" + "cde." + "abcd" + "efgh" + "ijkl" + "mnop" + "qrst" + "uvwx" + "yz12" + "3456" + "7890", wrap: (s) => `client_secret="${s}"` },
    { ruleId: "datadog-access-token", category: "Datadog API Key", secret: "ddap" + "i_9K" + "f8Lm" + "2Qp7" + "Zx4T" + "v1Bn" + "6Yc3" + "Rd8W" + "x5Hj" + "2M", wrap: (s) => `DD_API_KEY=${s}` },
    { ruleId: "linear-api-key", category: "Linear API Key", secret: "lin_" + "api_" + "9Kf8" + "Lm2Q" + "p7Zx" + "4Tv1" + "Bn6Y" + "c3Rd" + "8Wx5" + "Hj2M", wrap: (s) => `LINEAR_KEY=${s}` },
    { ruleId: "supabase-anon-or-service", category: "Supabase Service Key", secret: "sbp_" + "0123" + "4567" + "89ab" + "cdef" + "0123" + "4567" + "89ab" + "cdef" + "0123" + "4567", wrap: (s) => `SUPABASE_ACCESS_TOKEN=${s}` },
    { ruleId: "grafana-api-key", category: "Grafana Service Token", secret: "glsa" + "_aBc" + "DeFg" + "HiJk" + "LmNo" + "PqRs" + "TuVw" + "XyZ1" + "2345" + "678_" + "9a0b" + "1c2d", wrap: (s) => `GRAFANA_TOKEN=${s}` },
    { ruleId: "hashicorp-tf-api-token", category: "Terraform Cloud Token", secret: "aBcD" + "eFgH" + "iJkL" + "mN.a" + "tlas" + "v1.a" + "bcde" + "fghi" + "jklm" + "nopq" + "rstu" + "vwxy" + "z012" + "3456" + "789A" + "BCDE" + "F", wrap: (s) => `TFE_TOKEN=${s}` },
    { ruleId: "postman-api-token", category: "Postman API Key", secret: "PMAK" + "-64a" + "1b2c" + "3d4e" + "5f60" + "7182" + "93a4" + "b-01" + "2345" + "6789" + "abcd" + "ef01" + "2345" + "6789" + "abcd" + "ef", wrap: (s) => `POSTMAN_API_KEY=${s}` },
    { ruleId: "pulumi-api-token", category: "Pulumi Access Token", secret: "pul-" + "0123" + "4567" + "89ab" + "cdef" + "0123" + "4567" + "89ab" + "cdef" + "0123" + "4567", wrap: (s) => `PULUMI_ACCESS_TOKEN=${s}` },
    { ruleId: "perplexity-api-key", category: "Perplexity API Key", secret: "pplx" + "-012" + "3456" + "789a" + "bcde" + "f012" + "3456" + "789a" + "bcde" + "f012" + "3456" + "789a" + "bcde" + "f", wrap: (s) => `PPLX_API_KEY=${s}` },
    { ruleId: "groq-api-key", category: "Groq API Key", secret: "gsk_" + "aBcD" + "eFgH" + "iJkL" + "mNoP" + "qRsT" + "uVwX" + "yZ01" + "2345" + "6789" + "ABCD" + "EFGH" + "IJK", wrap: (s) => `GROQ_API_KEY=${s}` },
    { ruleId: "db-postgres-uri", category: "Postgres Connection URI", secret: "post" + "gres" + "://s" + "vc_p" + "rod:" + "Supe" + "rSec" + "ret9" + "9@db" + ".int" + "erna" + "l:54" + "32/p" + "ayme" + "nts", wrap: (s) => `DATABASE_URL=${s}` },
    { ruleId: "db-mongo-uri", category: "MongoDB SRV URI", secret: "mong" + "odb+" + "srv:" + "//ad" + "min:" + "MyMo" + "ngoP" + "ass1" + "23@c" + "lust" + "er0." + "exam" + "ple." + "net/" + "prod", wrap: (s) => `MONGO_URI=${s}` },
    { ruleId: "db-redis-uri", category: "Redis Auth URI", secret: "redi" + "s://" + "defa" + "ult:" + "Redi" + "sSec" + "ret4" + "56@c" + "ache" + ".int" + "erna" + "l:63" + "79", wrap: (s) => `REDIS_URL=${s}` },
    { ruleId: "http-bearer-auth", category: "HTTP Bearer Header", secret: "Auth" + "oriz" + "atio" + "n: B" + "eare" + "r op" + "aque" + "_pro" + "d_se" + "ssio" + "n_to" + "ken_" + "9876" + "5432" + "10", wrap: (s) => `Header -> ${s}` },
    { ruleId: "http-basic-auth", category: "HTTP Basic Header", secret: "Auth" + "oriz" + "atio" + "n: B" + "asic" + " dXN" + "lcjp" + "zdXB" + "lcl9" + "zZWN" + "yZXR" + "fcGF" + "zc3d" + "vcmQ" + "=", wrap: (s) => `curl -H "${s}" https://api.example.com` },
    { ruleId: "env-webhook-secret", category: "Webhook Signing Secret", secret: "whse" + "c_9K" + "f8Lm" + "2Qp7" + "Zx4T" + "v1Bn" + "6Yc3" + "Rd8W" + "x5Hj" + "2M", wrap: (s) => `webhook_secret=${s}` },
    { ruleId: "json-client-secret", category: "JSON Client Secret", secret: "s3cr" + "3t_V" + "9mK2" + "pL8q" + "R4tW" + "7yZ1" + "xN5", wrap: (s) => `{"client_secret":"${s}"}` },
    { ruleId: "digitalocean-pat", category: "DigitalOcean PAT", secret: "dop_" + "v1_0" + "1234" + "5678" + "9abc" + "def0" + "1234" + "5678" + "9abc" + "def0" + "1234" + "5678" + "9abc" + "def0" + "1234" + "5678" + "9abc" + "def", wrap: (s) => `DO_TOKEN=${s}` },
  ];

  let upstreamMatchedCount = 0;
  for (const item of specs) {
    const rawRx = upstreamRules.get(item.ruleId);
    let matchedUpstream = false;
    if (rawRx) {
      const rx = compileGoRegex(rawRx);
      if (rx) matchedUpstream = rx.test(item.wrap(item.secret));
    }
    if (matchedUpstream) upstreamMatchedCount++;
    item.upstreamRegexVerified = matchedUpstream;
    item.sampleText = item.wrap(item.secret);
  }

  return {
    sourceUrl: url,
    upstreamRulesParsed: upstreamRules.size,
    totalSpecs: specs.length,
    upstreamRegexVerifiedCount: upstreamMatchedCount,
    specs,
  };
}

// ---------------------------------------------------------------------------
// Suite C: 100 Hard Benign Developer & Prose Chunks (True FPR)
// ---------------------------------------------------------------------------
function buildSuiteC() {
  const chunks = [];
  const docFiles = [
    path.join(ROOT, "README.md"),
    path.join(ROOT, "package.json"),
    ...fs.readdirSync(path.join(ROOT, "src", "components"))
      .filter((f) => f.endsWith(".tsx"))
      .slice(0, 6)
      .map((f) => path.join(ROOT, "src", "components", f)),
  ];

  for (const filePath of docFiles) {
    if (!fs.existsSync(filePath)) continue;
    const raw = fs.readFileSync(filePath, "utf8");
    for (let i = 0; i < raw.length && chunks.length < 70; i += 420) {
      const slice = raw.slice(i, i + 320).trim();
      if (
        slice.length >= 150 &&
        !/AIza|AKIA|sk_live|sk-proj|ghp_|eyJ|PRIVATE KEY|555-|@example|9876543210|4532-0151/i.test(slice)
      ) {
        chunks.push({ source: path.relative(ROOT, filePath), text: slice });
      }
    }
  }

  const syntheticBenign = [
    "TypeError: Cannot read properties of undefined (reading 'map') at IncidentList (src/components/IncidentList.tsx:42:14)\nHTTP 502 Bad Gateway on /api/v1/health at 2026-11-22T03:00:00Z using react@19.0.0.",
    "This feature is a work in progress and will go live in production tomorrow. Call me later if it breaks during the canary rollout.",
    "My app works at scale using localStorage and contenteditable inside checkout-gateway after v4.8.2 deploy on port 8080.",
    "Please explain how Docker containers talk to each other on localhost port 8080 using bridge networking and DNS service discovery.",
    "FROM node:22-alpine\nWORKDIR /app\nCOPY package*.json ./\nRUN npm ci --omit=dev\nEXPOSE 4173\nCMD [\"npm\", \"run\", \"preview\"]",
    "interface TelemetryMetric {\n  medianMs: number;\n  p95Ms: number;\n  maxMs: number;\n  falsePositiveRate: number;\n}",
    "SELECT date_trunc('hour', created_at) AS bucket, count(*) FROM request_logs WHERE status_code >= 500 GROUP BY 1 ORDER BY 1 DESC;",
    "kubectl rollout status deployment/api-gateway -n production --timeout=120s && kubectl get pods -l app=api-gateway",
    "The quarterly engineering review highlighted steady progress across latency budgets, bundle splitting, and deterministic test coverage.",
    "When troubleshooting CORS preflight failures, verify Access-Control-Allow-Origin headers match the requesting origin cleanly.",
  ];

  while (chunks.length < 100) {
    const base = syntheticBenign[chunks.length % syntheticBenign.length];
    chunks.push({ source: "benign-dev-prose", text: base });
  }

  return chunks.slice(0, 100);
}

// ---------------------------------------------------------------------------
// Benchmark Runner
// ---------------------------------------------------------------------------
function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Number(sorted[idx].toFixed(3));
}

function runLevelBenchmark(level, suiteA, suiteB, suiteC, engineFn) {
  const latencies = [];
  const missedExamples = [];
  const fpExamples = [];
  let idempotencyFailures = 0;
  let totalSamples = 0;

  // Suite A counters
  let a1Total = 0, a1Caught = 0;
  let a2Total = 0, a2Caught = 0;
  const perCategory = new Map();
  const bumpCat = (cat, caught) => {
    const cur = perCategory.get(cat) || { total: 0, caught: 0 };
    cur.total++;
    if (caught) cur.caught++;
    perCategory.set(cat, cur);
  };

  for (const row of suiteA.rows) {
    totalSamples++;
    const t0 = performance.now();
    const res1 = engineFn(row.text, level);
    latencies.push(performance.now() - t0);

    const res2 = engineFn(res1.sanitizedText, level);
    if (res2.masks.length !== 0 || res2.sanitizedText !== res1.sanitizedText) {
      idempotencyFailures++;
    }

    for (const ent of row.privacy_mask) {
      if (!ent.value || ent.value.length < 2) continue;
      const caught = !res1.sanitizedText.includes(ent.value);
      bumpCat(ent.label, caught);
      if (A1_LABELS.has(ent.label)) {
        a1Total++;
        if (caught) a1Caught++;
        else if (missedExamples.length < 30) {
          missedExamples.push({ suite: "A1", category: ent.label, snippet: ent.value.slice(0, 48) });
        }
      } else if (A2_LABELS.has(ent.label)) {
        a2Total++;
        if (caught) a2Caught++;
      }
    }
  }

  // Suite B counters
  let bTotal = 0, bCaught = 0;
  for (const item of suiteB.specs) {
    totalSamples++;
    bTotal++;
    const t0 = performance.now();
    const res1 = engineFn(item.sampleText, level);
    latencies.push(performance.now() - t0);

    const res2 = engineFn(res1.sanitizedText, level);
    if (res2.masks.length !== 0 || res2.sanitizedText !== res1.sanitizedText) {
      idempotencyFailures++;
    }

    const caught = !res1.sanitizedText.includes(item.secret);
    bumpCat(`Gitleaks:${item.category}`, caught);
    if (caught) bCaught++;
    else if (missedExamples.length < 40) {
      missedExamples.push({ suite: "B", category: item.category, snippet: `${item.secret.slice(0, 12)}…` });
    }
  }

  // Suite C counters (Benign FPR)
  let cFlagged = 0;
  for (const chunk of suiteC) {
    totalSamples++;
    const t0 = performance.now();
    const res1 = engineFn(chunk.text, level);
    latencies.push(performance.now() - t0);

    const res2 = engineFn(res1.sanitizedText, level);
    if (res2.masks.length !== 0 || res2.sanitizedText !== res1.sanitizedText) {
      idempotencyFailures++;
    }

    if (res1.masks.length > 0) {
      cFlagged++;
      for (const m of res1.masks) {
        if (fpExamples.length < 25) {
          fpExamples.push({
            source: chunk.source,
            category: m.category,
            detector: m.detector,
            matchedText: (m.matchedText || "").slice(0, 60),
          });
        }
      }
    }
  }

  const sortedLat = [...latencies].sort((a, b) => a - b);
  const categoryBreakdown = {};
  for (const [k, v] of perCategory.entries()) {
    categoryBreakdown[k] = {
      caught: v.caught,
      total: v.total,
      recallPct: Number(((v.caught / Math.max(1, v.total)) * 100).toFixed(1)),
    };
  }

  return {
    level,
    totalSamples,
    suiteA1: { caught: a1Caught, total: a1Total, recallPct: Number(((a1Caught / Math.max(1, a1Total)) * 100).toFixed(1)) },
    suiteA2: { caught: a2Caught, total: a2Total, recallPct: Number(((a2Caught / Math.max(1, a2Total)) * 100).toFixed(1)) },
    suiteB: { caught: bCaught, total: bTotal, recallPct: Number(((bCaught / Math.max(1, bTotal)) * 100).toFixed(1)) },
    suiteC: { flagged: cFlagged, total: suiteC.length, fprPct: Number(((cFlagged / suiteC.length) * 100).toFixed(1)) },
    latency: {
      medianMs: percentile(sortedLat, 50),
      p95Ms: percentile(sortedLat, 95),
      maxMs: percentile(sortedLat, 100),
    },
    idempotencyFailures,
    categoryBreakdown,
    missedExamples,
    fpExamples,
  };
}

async function main() {
  const suiteA = await fetchSuiteA();
  const suiteB = await fetchSuiteB();
  const suiteC = buildSuiteC();

  const extRunner = (text, level) => {
    const r = extScrubSync(text, true, level);
    return { sanitizedText: r.sanitizedText, masks: r.mergedSpans };
  };
  const webRunner = (text, level) => {
    const r = scanAndRedactLocal(text, {
      protectionLevel: level,
      includeHeuristics: true,
      enableEntropyScanner: true,
    });
    return { sanitizedText: r.sanitizedText, masks: r.mergedSpans };
  };

  const results = {
    generatedAt: new Date().toISOString(),
    provenance: {
      suiteA: { dataset: suiteA.dataset, split: suiteA.split, sourceUrl: suiteA.sourceUrl, rowRange: suiteA.rowRange, rows: suiteA.count },
      suiteB: { sourceUrl: suiteB.sourceUrl, upstreamRulesParsed: suiteB.upstreamRulesParsed, totalSpecs: suiteB.totalSpecs, upstreamRegexVerifiedCount: suiteB.upstreamRegexVerifiedCount },
      suiteC: { totalChunks: suiteC.length },
    },
    extensionFirewallCore: {},
    webSrcFirewall: {},
  };

  for (const level of ["low", "medium", "high"]) {
    results.extensionFirewallCore[level] = runLevelBenchmark(level, suiteA, suiteB, suiteC, extRunner);
    results.webSrcFirewall[level] = runLevelBenchmark(level, suiteA, suiteB, suiteC, webRunner);
  }

  fs.writeFileSync(REPORT_PATH, JSON.stringify(results, null, 2));
  console.log(`Saved benchmark baseline to ${REPORT_PATH}`);

  // Print concise machine-readable summary for diagnostic inspection
  for (const level of ["low", "medium", "high"]) {
    const e = results.extensionFirewallCore[level];
    const w = results.webSrcFirewall[level];
    console.log(
      `[EXT ${level.toUpperCase()}] A1=${e.suiteA1.recallPct}% (${e.suiteA1.caught}/${e.suiteA1.total}) | A2=${e.suiteA2.recallPct}% (${e.suiteA2.caught}/${e.suiteA2.total}) | B=${e.suiteB.recallPct}% (${e.suiteB.caught}/${e.suiteB.total}) | C_FPR=${e.suiteC.fprPct}% (${e.suiteC.flagged}/${e.suiteC.total}) | med=${e.latency.medianMs}ms p95=${e.latency.p95Ms}ms | idemFail=${e.idempotencyFailures}`,
    );
    console.log(
      `[WEB ${level.toUpperCase()}] A1=${w.suiteA1.recallPct}% | A2=${w.suiteA2.recallPct}% | B=${w.suiteB.recallPct}% | C_FPR=${w.suiteC.fprPct}% | idemFail=${w.idempotencyFailures}`,
    );
  }
}

main().catch((err) => {
  console.error("BENCHMARK FAILED:", err);
  process.exit(1);
});
