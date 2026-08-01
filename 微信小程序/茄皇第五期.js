/**
 * 统一茄皇的家五期 - 自动化脚本（Node.js）
 * 流程：登录 -> 任务 -> 浇水 -> 好友列表 -> 偷能量
 *
 * cron: 25 10 * * *
 * new Env('统一茄皇五期')
 *
 * 环境变量：
 *   QH              账号信息，格式：wid#openId
 *                   多账号使用 & 分割或换行分割
 *                   示例：QH="wid123#openid456"
 *   qiehuang_ck     兼容旧格式 wid----openId
 *   QH_PROXY_API    可选，代理API地址
 *   抓包链接 https://xapi.weimob.com/fe/mapi/user/loginX 在响应里面都有这个两个参数
 * 活动入口：
 *   https://picui.ogmua.cn/s1/2026/07/24/6a625750543d2.webp
 * 功能特性：
 *   ✓ 多账号批量处理
 *   ✓ 账号隐私保护（隐藏部分字符）
 *   ✓ 真人操作模拟（随机延迟）
 *   ✓ 详细日志记录
 *   ✓ 错误处理和重试机制
 *   ✓ 格式化通知内容
 *   ✓ 集成青龙面板 sendNotify
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const tls = require("tls");
const { URL } = require("url");

// 青龙面板 sendNotify 模块
let sendNotify;
try {
  sendNotify = require("./sendNotify").sendNotify;
} catch {
  try {
    sendNotify = require("./notify").sendNotify;
  } catch {
    sendNotify = async (title, content) => {
      console.log(`[通知] ${title}\n${content}`);
    };
  }
}
// 活动服务端 RSA 公钥（公开配置，非私人密钥）
const BASE_URL = "https://farmgames.ioutu.cn";
const BUILTIN_SHARE_TOMATO_USER_ID = "3879";
const PUBLIC_KEY_B64 =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA70sK419vy3MabW3lEGlk7Zh1u78OdnVlioVazp5Y46eBh+/TDqo/wZ9VrQ/4MmAtoP0vJ2vmwP5gqO3WPojb07WddXfF1eU+5M+Rj3s0eSRrvZvBcGZ3qK0dOgZJScK66IDQazt/c4xqhDcsItIyNRahUqB/IKc6E80GZJvMvFtZVSCseAXC0mAJXhi1AdUOlP+3Pv0fiUVejTJp1j7LBNWJ7Z5/8mRcclQH0vmxsdYsaV3qZiJ2d/CfNoKcwmI2IWmeZy8NP5U8Hn0AsxPEwjdHoEqG/iy/SoA46TZL+RLtWqUSHXpaKR/VFN0rbl25SE91X8FTfLqyD8LfGMCwRQIDAQAB";

const DEFAULT_BROWSE_TARGETS = {
  BROWSE_QIEHUANG:
    "/cms_design/design?productInstanceId=3171023957&vid=0&pageid=91156028957&essharewid=1501328539&share_vid=6013753979957&pmc=3%7C5.essharewid.0-3.vid.0-2%7C3%7C5.share_vid.86400",
  BROWSE_AISANG:
    "/cms_design/design?productInstanceId=3171023957&vid=0&pageid=90424108957&essharewid=1501328539&share_vid=6013753979957&pmc=3%7C5.essharewid.0-3.vid.0-2%7C3%7C5.share_vid.86400",
};

// ===================== 工具 =====================
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const pick = (arr) => arr[randInt(0, arr.length - 1)];
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

// 账号隐私保护：隐藏中间部分字符
function maskStr(str, keepStart = 4, keepEnd = 4) {
  if (!str || str.length <= keepStart + keepEnd) return str || "";
  return str.slice(0, keepStart) + "*".repeat(Math.min(6, str.length - keepStart - keepEnd)) + str.slice(-keepEnd);
}

// 执行日志收集器
class RunLogger {
  constructor() {
    this.startTime = Date.now();
    this.accounts = [];
    this.currentAccount = null;
  }
  startAccount(idx, name, wid, openId) {
    this.currentAccount = {
      idx, name,
      widDisplay: maskStr(wid),
      openIdDisplay: maskStr(openId),
      logs: [],
      success: false,
      error: null,
    };
  }
  log(msg) {
    const t = new Date().toLocaleString("zh-CN", { hour12: false });
    const line = `[${t}] ${msg}`;
    console.log(line);
    if (this.currentAccount) this.currentAccount.logs.push(msg);
  }
  endAccount(success, error = null) {
    if (this.currentAccount) {
      this.currentAccount.success = success;
      this.currentAccount.error = error;
      this.accounts.push(this.currentAccount);
      this.currentAccount = null;
    }
  }
  getElapsed() {
    return ((Date.now() - this.startTime) / 1000).toFixed(1);
  }
  buildReport() {
    const total = this.accounts.length;
    const ok = this.accounts.filter((a) => a.success).length;
    const fail = total - ok;
    const elapsed = this.getElapsed();
    const now = new Date().toLocaleString("zh-CN", { hour12: false });

    const lines = [];
    lines.push("🍅 统一茄皇五期 · 运行报告");
    lines.push(`⏰ 执行时间：${now}`);
    lines.push(`⏱ 耗时：${elapsed} 秒`);
    lines.push(`📊 统计：共 ${total} 个账号，成功 ${ok}，失败 ${fail}`);
    lines.push("━━━━━━━━━━━━━━━━━━━━");

    for (const acc of this.accounts) {
      const status = acc.success ? "✅" : "❌";
      lines.push(`${status} 账号${acc.idx} (${acc.widDisplay})`);
      for (const log of acc.logs) {
        lines.push(`  ${log}`);
      }
      if (acc.error) {
        lines.push(`  ❗ 错误：${acc.error}`);
      }
      lines.push("────────────────────");
    }
    return lines.join("\n");
  }
}

function log(...args) {
  const t = new Date().toLocaleString("zh-CN", { hour12: false });
  console.log(`[${t}]`, ...args);
}

function out(msg) {
  console.log(msg);
}

function divider() {
  console.log("━━━━━━━━━━━━━━━━━━━━");
}

function gaussDelay(mean, std = mean * 0.25, min = mean * 0.45, max = mean * 2.2) {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return Math.round(clamp(mean + z * std, min, max));
}

async function humanDelay(kind = "default") {
  const profile = {
    query: [450, 1400],
    action: [900, 2600],
    heavy: [1200, 3200],
    browse: [2500, 6500],
    think: [800, 2200],
    account: [3500, 9000],
    default: [600, 1800],
  };
  const [min, max] = profile[kind] || profile.default;
  const mean = (min + max) / 2;
  const ms = gaussDelay(mean, (max - min) / 4, min, max);
  await sleep(ms);
  return ms;
}


// 重试机制（指数退避）
async function retryWithBackoff(fn, { retries = 2, baseDelay = 2000, label = "" } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) {
        const delay = baseDelay * Math.pow(2, i) + randInt(200, 800);
        if (label) log(`[${label}] 第${i + 1}次重试，等待 ${delay}ms...`);
        await sleep(delay);
      }
    }
  }
  throw lastErr;
}
// ===================== 小程序指纹 / UA =====================
const DEVICE_POOL = [
  { brand: "Xiaomi", model: "2201123C", market: "MI 12", android: "13", build: "TKQ1.220829.002" },
  { brand: "Xiaomi", model: "2304FPN6DC", market: "MI 13", android: "14", build: "UKQ1.230804.001" },
  { brand: "Xiaomi", model: "23116PN5BC", market: "MI 14", android: "15", build: "AQ3A.240912.001" },
  { brand: "Redmi", model: "23113RKC6C", market: "Redmi K70", android: "14", build: "UKQ1.230917.001" },
  { brand: "Redmi", model: "22101316C", market: "Redmi Note 12", android: "13", build: "TKQ1.221114.001" },
  { brand: "HUAWEI", model: "ALN-AL00", market: "Mate 60", android: "12", build: "HUAWEIALN-AL00" },
  { brand: "HUAWEI", model: "BRA-AL00", market: "P60", android: "12", build: "HUAWEIBRA-AL00" },
  { brand: "OPPO", model: "PGFM10", market: "Find X6", android: "14", build: "UKQ1.230924.001" },
  { brand: "vivo", model: "V2309A", market: "X100", android: "14", build: "UP1A.231005.007" },
  { brand: "vivo", model: "V2324A", market: "X100 Pro", android: "15", build: "AP3A.240905.015" },
  { brand: "samsung", model: "SM-S9180", market: "Galaxy S23 Ultra", android: "14", build: "UP1A.231005.007" },
  { brand: "OnePlus", model: "PJE110", market: "OnePlus 12", android: "14", build: "UKQ1.230924.001" },
  { brand: "HONOR", model: "REA-AN00", market: "Magic6", android: "14", build: "HONORREA-AN00" },
  { brand: "realme", model: "RMX3888", market: "GT5 Pro", android: "14", build: "UKQ1.230924.001" },
];

const WECHAT_VERSIONS = [
  { ver: "8.0.49.2600", hex: "2800313A", sdk: "20240102" },
  { ver: "8.0.50.2701", hex: "2800321D", sdk: "20240206" },
  { ver: "8.0.51.2720", hex: "28003310", sdk: "20240305" },
  { ver: "8.0.52.2740", hex: "28003414", sdk: "20240402" },
  { ver: "8.0.53.2760", hex: "28003518", sdk: "20240507" },
  { ver: "8.0.54.2780", hex: "2800361C", sdk: "20240604" },
];

const CHROME_VERSIONS = [
  "108.0.5359.156",
  "114.0.5735.196",
  "119.0.6045.193",
  "120.0.6099.210",
  "121.0.6167.178",
  "122.0.6261.119",
];

function randomHex(n) {
  return crypto.randomBytes(n).toString("hex");
}

function buildMiniProgramFingerprint() {
  const device = pick(DEVICE_POOL);
  const wechat = pick(WECHAT_VERSIONS);
  const chrome = pick(CHROME_VERSIONS);
  const mmwebid = String(randInt(1800, 9999));
  const xweb = String(randInt(11700, 12950));
  const netType = pick(["WIFI", "WIFI", "WIFI", "5G", "4G"]);
  const language = pick(["zh_CN", "zh_CN", "zh_CN", "zh_TW"]);
  const wmpf = `WMPF/${pick(["1.0.0", "1.1.0", "1.2.0", "1.3.0"])}`;
  const platform = "android";

  const ua =
    `Mozilla/5.0 (Linux; Android ${device.android}; ${device.market} Build/${device.build}; wv) ` +
    `AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/${chrome} Mobile Safari/537.36 ` +
    `XWEB/${xweb} MMWEBSDK/${wechat.sdk} MMWEBID/${mmwebid} ` +
    `MicroMessenger/${wechat.ver}(${wechat.hex}) WeChat/arm64 Weixin ` +
    `NetType/${netType} Language/${language} ABI/arm64 MiniProgramEnv/${platform} ${wmpf}`;

  return {
    userAgent: ua,
    brand: device.brand,
    model: device.market,
    modelCode: device.model,
    android: device.android,
    build: device.build,
    wechat: wechat.ver,
    chrome,
    netType,
    language,
    xweb,
    mmwebid,
    platform,
    sessionId: randomHex(16),
    clientId: `${randomHex(8)}-${randomHex(4)}-${randomHex(4)}-${randomHex(4)}-${randomHex(12)}`,
  };
}

// ===================== 加密 =====================
function pemFromSpkiB64(b64) {
  const lines = b64.match(/.{1,64}/g).join("\n");
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

function encryptRequestBody(plainObj, publicKeyB64 = PUBLIC_KEY_B64) {
  const plain = Buffer.from(JSON.stringify(plainObj), "utf8");
  const aesKey = crypto.randomBytes(32);
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
  const enc = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  const dataBuf = Buffer.concat([enc, tag]);

  const pem = pemFromSpkiB64(publicKeyB64);
  const encryptedKey = crypto.publicEncrypt(
    {
      key: pem,
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: "sha256",
    },
    aesKey
  );

  return {
    data: dataBuf.toString("base64"),
    key: encryptedKey.toString("base64"),
    iv: iv.toString("base64"),
  };
}

// ===================== HTTP =====================
function parseProxy(text) {
  let s = String(text || "").trim().split(/\r?\n/)[0].trim();
  if (!s) throw new Error("代理API返回为空");
  if (/不足|过期|失败|error|false|请|白名单|余额/i.test(s) && !/^\d+\.\d+\.\d+\.\d+/.test(s)) {
    throw new Error(`代理API异常: ${s}`);
  }

  let protocol = "http";
  let host = "";
  let port = 0;
  let username = "";
  let password = "";

  if (/^https?:\/\//i.test(s)) {
    const u = new URL(s);
    protocol = u.protocol.replace(":", "") || "http";
    host = u.hostname;
    port = Number(u.port || (protocol === "https" ? 443 : 80));
    username = decodeURIComponent(u.username || "");
    password = decodeURIComponent(u.password || "");
  } else if (s.includes("@")) {
    const [auth, hp] = s.split("@");
    const authParts = auth.split(":");
    username = authParts[0] || "";
    password = authParts.slice(1).join(":") || "";
    const [h, p] = hp.split(":");
    host = h;
    port = Number(p);
  } else {
    const parts = s.split(":");
    if (parts.length >= 2) {
      host = parts[0];
      port = Number(parts[1]);
      if (parts.length >= 4) {
        username = parts[2];
        password = parts.slice(3).join(":");
      }
    }
  }

  if (!host || !port) throw new Error(`无法解析代理: ${s}`);
  return {
    protocol,
    host,
    port,
    username,
    password,
    raw: s,
    display: username ? `${host}:${port}(auth)` : `${host}:${port}`,
  };
}

function fetchText(urlStr, { timeout = 15000, proxy = null } = {}) {
  return requestRaw("GET", urlStr, { timeout, proxy, headers: { Accept: "*/*" } }).then((r) => r.text);
}

async function fetchProxyFromApi(apiUrl, retries = 3) {
  if (!apiUrl) throw new Error("未配置代理API");
  let lastErr = null;
  for (let i = 1; i <= retries; i++) {
    try {
      const text = await fetchText(apiUrl, { timeout: 12000, proxy: null });
      const proxy = parseProxy(text);
      return proxy;
    } catch (e) {
      lastErr = e;
      await sleep(800 * i + randInt(200, 600));
    }
  }
  throw new Error(`获取代理失败: ${lastErr ? lastErr.message : "unknown"}`);
}

function connectViaHttpProxy(proxy, targetHost, targetPort, timeout = 20000) {
  return new Promise((resolve, reject) => {
    const headers = {
      Host: `${targetHost}:${targetPort}`,
      Connection: "keep-alive",
    };
    if (proxy.username) {
      const token = Buffer.from(`${proxy.username}:${proxy.password || ""}`).toString("base64");
      headers["Proxy-Authorization"] = `Basic ${token}`;
    }

    const req = http.request({
      host: proxy.host,
      port: proxy.port,
      method: "CONNECT",
      path: `${targetHost}:${targetPort}`,
      headers,
      timeout,
    });

    req.on("connect", (res, socket) => {
      if (res.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`代理CONNECT失败 status=${res.statusCode}`));
        return;
      }
      resolve(socket);
    });
    req.on("timeout", () => {
      req.destroy(new Error("代理连接超时"));
    });
    req.on("error", reject);
    req.end();
  });
}

function requestRaw(method, urlStr, { headers = {}, body = null, timeout = 20000, proxy = null } = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === "https:";
      const data = body == null ? null : Buffer.from(body, "utf8");
      const finalHeaders = {
        ...headers,
        Host: u.host,
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      };
      if (proxy) {
        finalHeaders["Accept-Encoding"] = "identity";
      }

      const handleResponse = (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (_) {}
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text,
            json,
          });
        });
      };

      if (!isHttps && proxy) {
        const opts = {
          host: proxy.host,
          port: proxy.port,
          method,
          path: urlStr,
          headers: finalHeaders,
          timeout,
        };
        if (proxy.username) {
          opts.headers["Proxy-Authorization"] =
            "Basic " + Buffer.from(`${proxy.username}:${proxy.password || ""}`).toString("base64");
        }
        const req = http.request(opts, handleResponse);
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("request timeout")));
        if (data) req.write(data);
        req.end();
        return;
      }

      if (isHttps && proxy) {
        const socket = await connectViaHttpProxy(
          proxy,
          u.hostname,
          Number(u.port || 443),
          timeout
        );
        const req = https.request(
          {
            method,
            host: u.hostname,
            port: Number(u.port || 443),
            path: u.pathname + u.search,
            headers: finalHeaders,
            timeout,
            createConnection: () =>
              tls.connect({
                host: u.hostname,
                servername: u.hostname,
                socket,
                rejectUnauthorized: true,
              }),
          },
          handleResponse
        );
        req.on("error", reject);
        req.on("timeout", () => req.destroy(new Error("request timeout")));
        if (data) req.write(data);
        req.end();
        return;
      }

      const lib = isHttps ? https : http;
      const req = lib.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname + u.search,
          method,
          headers: finalHeaders,
          timeout,
        },
        handleResponse
      );
      req.on("error", reject);
      req.on("timeout", () => req.destroy(new Error("request timeout")));
      if (data) req.write(data);
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

// ===================== 客户端 =====================
class QiehuangClient {
  constructor(account, globalCfg = {}) {
    this.name = account.name || `账号${globalCfg._index || 1}`;
    this.openId = String(account.openId);
    this.wid = String(account.wid);

    this.token = null;
    this.user = null;
    this.proxy = null;
    this.proxyApiUrl = globalCfg.proxyApiUrl || "";
    this.shareTomatoUserId = BUILTIN_SHARE_TOMATO_USER_ID;
    this.fp = buildMiniProgramFingerprint();
    this.delayProfile = {
      minIntervalMs: 380,
      jitter: true,
    };
    this._lastRequestAt = 0;
    this._requestSeq = 0;
  }

  async ensureProxy(force = false) {
    if (this.proxy && !force) return this.proxy;
    if (!this.proxyApiUrl) return null;
    const proxy = await fetchProxyFromApi(this.proxyApiUrl);
    this.proxy = proxy;
    return proxy;
  }

  referer() {
    const q = new URLSearchParams({
      wid: this.wid,
      openId: this.openId,
    });
    if (this.shareTomatoUserId) q.set("shareTomatoUserId", this.shareTomatoUserId);
    return `${BASE_URL}/?${q.toString()}`;
  }

  baseHeaders(extra = {}) {
    return {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "User-Agent": this.fp.userAgent,
      Referer: this.referer(),
      Origin: BASE_URL,
      "Accept-Language": `${this.fp.language.replace("_", "-")},zh;q=0.9,en-US;q=0.8,en;q=0.7`,
      "Accept-Encoding": "identity",
      "X-Requested-With": "com.tencent.mm",
      Connection: "keep-alive",
      "sec-ch-ua-platform": `"Android"`,
      "sec-ch-ua-mobile": "?1",
      ...extra,
    };
  }

  async api(
    method,
    apiPath,
    { query = null, body = null, encrypt = false, auth = true, delayKind = null } = {}
  ) {
    let kind = delayKind;
    if (!kind) {
      if (method === "GET") kind = "query";
      else if (apiPath.includes("energy/use")) kind = "heavy";
      else if (apiPath.includes("page-visit")) kind = "browse";
      else if (apiPath.includes("login") || apiPath.includes("complete")) kind = "action";
      else kind = "default";
    }

    if (kind !== "none") {
      const waited = await humanDelay(kind);
      const since = Date.now() - this._lastRequestAt;
      if (this._lastRequestAt && since < this.delayProfile.minIntervalMs) {
        await sleep(this.delayProfile.minIntervalMs - since + randInt(20, 120));
      }
      if (process.env.QH_DEBUG_DELAY === "1") {
        log(`[${this.name}] delay(${kind}) ~${waited}ms -> ${method} ${apiPath}`);
      }
    }

    let url = BASE_URL + apiPath;
    if (query) {
      const qs = new URLSearchParams(query).toString();
      url += (url.includes("?") ? "&" : "?") + qs;
    }

    this._requestSeq += 1;
    const headers = this.baseHeaders();
    if (auth && this.token) headers.Authorization = this.token;

    let payload = null;
    if (body != null) {
      if (encrypt) {
        const plain = { ...body };
        delete plain.requestConfig;
        const enc = encryptRequestBody(plain);
        payload = JSON.stringify(enc);
        headers["X-Request-Encrypted"] = "true";
      } else {
        payload = JSON.stringify(body);
      }
    } else if (method === "POST" || method === "PUT") {
      payload = "";
    }

    if (!this.proxy && this.proxyApiUrl) {
      await this.ensureProxy(true);
    }

    let res;
    try {
      res = await requestRaw(method, url, {
        headers,
        body: payload,
        proxy: this.proxy,
      });
    } catch (e) {
      const msg = String(e.message || e);
      if (this.proxyApiUrl && /代理|ECONN|ETIMEDOUT|socket|CONNECT|timeout/i.test(msg)) {
        await this.ensureProxy(true);
        res = await requestRaw(method, url, {
          headers,
          body: payload,
          proxy: this.proxy,
        });
      } else {
        throw e;
      }
    }
    this._lastRequestAt = Date.now();

    if (!res.json) {
      throw new Error(
        `${method} ${apiPath} 非 JSON 响应 status=${res.status} body=${res.text.slice(0, 200)}`
      );
    }

    const msg = String(res.json.msg || "");
    if (res.json.code === 500 && msg.includes("频繁")) {
      const cool = randInt(3500, 6500);
      await sleep(cool);
    }

    return res.json;
  }

  buildLoginPlain() {
    const plain = {
      openId: String(this.openId).trim(),
      wid: String(this.wid).trim(),
      shareTomatoUserId: String(BUILTIN_SHARE_TOMATO_USER_ID),
      queryCardStatus: true,
    };
    return plain;
  }

  async login({ silent = false } = {}) {
    const plain = this.buildLoginPlain();

    const resp = await this.api("POST", "/api/web/open/tomato/login", {
      body: plain,
      encrypt: true,
      auth: false,
    });

    if (resp.code !== 200 || !resp.data?.token) {
      throw new Error(`登录失败: ${JSON.stringify(resp)}`);
    }

    this.token = resp.data.token;
    this.user = resp.data;
    if (!silent) {
      out(`登录成功：${resp.data.nickName || "未设置昵称"}`);
    }
    return resp.data;
  }

  async home() {
    const resp = await this.api("GET", "/api/web/member/tomato/home");
    if (resp.code !== 200) throw new Error(`home失败: ${JSON.stringify(resp)}`);
    this.user = { ...this.user, ...resp.data };
    return resp.data;
  }

  async pageVisit(pagePath = "/pages/home/index") {
    const resp = await this.api("POST", "/api/web/member/tomato/page-visit", {
      body: { pagePath: String(pagePath).slice(0, 500) },
      encrypt: true,
    });
    return resp;
  }

  async getTasks() {
    const resp = await this.api("GET", "/api/web/member/tomato/tasks");
    if (resp.code !== 200) throw new Error(`tasks失败: ${JSON.stringify(resp)}`);
    return resp.data || [];
  }

  async completeTask(task) {
    const body = {
      taskType: task.taskType,
      browseTarget: task.browseTarget || "",
    };
    const resp = await this.api("POST", "/api/web/member/tomato/tasks/complete", {
      body,
      encrypt: true,
    });
    return resp;
  }

  async doTasks(logger) {
    const _log = logger ? (msg) => logger.log(msg) : (msg) => out(msg);
    let tasks = await this.getTasks();
    let completedCount = 0;

    for (const task of tasks) {
      if (String(task.completed) === "1" || task.actionType === "DONE") {
        _log(`  ✔ ${task.taskName}（已完成）`);
        continue;
      }

      if (task.taskType === "FRIEND_STEAL_ENERGY") {
        continue;
      }

      try {
        if (task.taskType === "BROWSE") {
          const target = task.browseTarget || DEFAULT_BROWSE_TARGETS.BROWSE_QIEHUANG;
          await this.pageVisit(target);
          await humanDelay("browse");
        }

        const resp = await this.completeTask(task);
        if (resp.code === 200) {
          const reward = resp.data?.rewardText || task.rewardText || "已领取";
          _log(`  ✔ ${task.taskName}（${reward}）`);
          completedCount++;
        } else {
          _log(`  ✖ ${task.taskName}（${resp.msg || "失败"}）`);
          if (String(resp.msg || "").includes("频繁")) {
            await humanDelay("heavy");
            await sleep(randInt(2500, 4500));
            const retry = await this.completeTask(task);
            if (retry.code === 200) {
              _log(`  ✔ ${task.taskName}（重试成功）`);
              completedCount++;
            }
          }
        }
      } catch (e) {
        _log(`  ✖ ${task.taskName}（${e.message}）`);
      }

      await humanDelay("think");
    }

    _log(`任务完成 ${completedCount} 个`);
    tasks = await this.getTasks();
    return tasks;
  }

  async waterAll(logger) {
    const _log = logger ? (msg) => logger.log(msg) : (msg) => out(msg);
    const before = await this.home();
    const energy = Number(before.energyBalance || 0);
    if (energy <= 0) {
      _log(`使用能量：当前没有可用能量`);
      return before;
    }
    const resp = await this.api("POST", "/api/web/member/tomato/energy/use", {
      body: null,
      encrypt: false,
    });
    if (resp.code !== 200) {
      _log(`使用能量失败：${resp.msg || "未知错误"}`);
      return resp;
    }
    const d = resp.data || {};
    const gained = d.gainedTomatoAmount || 0;
    _log(
      `使用能量：消耗 ${d.usedEnergyAmount || energy}，获得番茄 ${gained}，` +
      `${d.stageName || "未知阶段"} ${d.currentExp || 0}/${d.stageRequiredExp || 0}`
    );
    return d;
  }

  async getFriends(pageNum = 1, pageSize = 20) {
    const resp = await this.api("GET", "/api/web/member/tomato/friends", {
      query: { pageNum: String(pageNum), pageSize: String(pageSize) },
    });
    if (resp.code !== 200) throw new Error(`friends失败: ${JSON.stringify(resp)}`);
    return resp;
  }

  async friendHome(friendUserId) {
    const resp = await this.api("GET", `/api/web/member/tomato/friends/${friendUserId}/home`);
    if (resp.code !== 200) throw new Error(`friendHome失败: ${JSON.stringify(resp)}`);
    return resp.data || {};
  }

  async stealFriendEnergy(friendUserId) {
    const resp = await this.api("POST", "/api/web/member/tomato/friends/steal", {
      body: { friendTomatoUserId: friendUserId },
      encrypt: true,
    });
    return resp;
  }

  async stealFromFriends(logger) {
    const _log = logger ? (msg) => logger.log(msg) : (msg) => out(msg);
    const list = await this.getFriends(1, 50);
    const rows = list.rows || [];
    if (!rows.length) {
      _log(`好友能量：暂无好友`);
      return [];
    }

    const stealable = rows.filter(
      (f) => Number(f.friendStatus) === 0 && f.friendTomatoUserId
    );
    if (!stealable.length) {
      _log(`好友能量：暂无可收取能量`);
      return rows;
    }

    let stolenCount = 0;
    let stolenEnergy = 0;
    let failedCount = 0;

    for (const f of stealable) {
      const nick = f.friendNickName || "好友";
      try {
        const friendHome = await this.friendHome(f.friendTomatoUserId);
        const amount = Number(friendHome.stealAmount || 0);
        if (String(friendHome.canSteal) !== "1" || amount <= 0) continue;

        const resp = await this.stealFriendEnergy(f.friendTomatoUserId);
        if (resp.code === 200) {
          stolenCount += 1;
          stolenEnergy += amount;
        } else {
          failedCount += 1;
        }
      } catch (e) {
        failedCount += 1;
      }
      await humanDelay("action");
    }

    if (stolenCount) {
      let msg = `好友能量：收取 ${stolenCount} 位好友，共 ${stolenEnergy} 能量`;
      if (failedCount) msg += `（失败 ${failedCount} 位）`;
      _log(msg);
    } else if (failedCount) {
      _log(`好友能量：收取失败 ${failedCount} 位`);
    } else {
      _log(`好友能量：暂无可收取能量`);
    }

    return rows;
  }

  async createInviteQrcode() {
    const resp = await this.api("POST", "/api/web/member/tomato/miniprogram/qrcode/create", {
      body: {},
      encrypt: true,
    });
    return resp;
  }

  async checkInviteFriendBound() {
    const inviteId = String(BUILTIN_SHARE_TOMATO_USER_ID);
    try {
      const list = await this.getFriends(1, 50);
      const rows = list.rows || [];
      const hit = rows.find((f) => String(f.friendTomatoUserId) === inviteId);
      return { bound: !!hit, rows, total: list.total || rows.length, hit };
    } catch (e) {
      return { bound: false, rows: [], total: 0, hit: null, error: e.message };
    }
  }

  async ensureInviteFriend() {
    const inviteId = String(BUILTIN_SHARE_TOMATO_USER_ID);

    if (this.user && String(this.user.tomatoUserId) === inviteId) {
      return true;
    }

    let check = await this.checkInviteFriendBound();
    if (check.bound) {
      return true;
    }

    await humanDelay("action");
    const plainNum = {
      openId: String(this.openId).trim(),
      wid: String(this.wid).trim(),
      shareTomatoUserId: Number(BUILTIN_SHARE_TOMATO_USER_ID),
      queryCardStatus: true,
    };
    const resp = await this.api("POST", "/api/web/open/tomato/login", {
      body: plainNum,
      encrypt: true,
      auth: false,
    });
    if (resp.code === 200 && resp.data?.token) {
      this.token = resp.data.token;
    }
    await humanDelay("query");
    check = await this.checkInviteFriendBound();
    if (check.bound) {
      return true;
    }

    return false;
  }

  async runDaily(logger) {
    const _log = logger ? (msg) => logger.log(msg) : out;

    if (this.proxyApiUrl) {
      await this.ensureProxy(true);
    }
    await humanDelay("think");

    _log("正在登录...");
    await this.login();
    _log("登录成功");
    await humanDelay("think");

    _log("检查邀请好友...");
    await this.ensureInviteFriend();
    await humanDelay("think");

    await this.pageVisit("/pages/home/index");
    await humanDelay("think");

    let home = await this.home();
    _log(
      `当前状态：能量 ${home.energyBalance}，番茄 ${home.tomatoBalance}，` +
      `${home.stageName || "未知阶段"} ${home.currentExp || 0}/${home.stageRequiredExp || 0}`
    );

    _log("开始执行任务...");
    await this.doTasks(logger);
    await humanDelay("think");

    _log("浇水...");
    home = await this.waterAll(logger);
    await humanDelay("think");

    _log("偷取好友能量...");
    await this.stealFromFriends(logger);

    home = await this.home();
    _log(
      `最终状态：能量 ${home.energyBalance}，番茄 ${home.tomatoBalance}，` +
      `${home.stageName || "未知阶段"} ${home.currentExp || 0}/${home.stageRequiredExp || 0}`
    );
    return home;
  }
}

// ===================== 账号加载 =====================
function parseAccountLine(line, idx) {
  const raw = String(line || "").trim();
  if (!raw || raw.startsWith("#") || raw.startsWith("//")) return null;

  let wid, openId;

  // 优先匹配 wid#openId 格式
  if (raw.includes("#")) {
    const parts = raw.split("#").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      [wid, openId] = parts;
    } else {
      return null;
    }
  }
  // 兼容旧格式 wid----openId
  else if (raw.includes("----")) {
    const parts = raw.split("----").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      [wid, openId] = parts;
    } else {
      return null;
    }
  }
  // 仅 openId（无 wid）
  else if (raw.startsWith("o") && raw.length > 10) {
    wid = null;
    openId = raw;
  } else {
    return null;
  }

  if (!openId) return null;
  return {
    name: `账号${idx + 1}`,
    openId,
    wid: wid || null,
    enabled: true,
  };
}

function parseAccountsFromText(text) {
  if (!text) return [];
  const lines = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/&/g, "\n")
    .replace(/；/g, "\n")
    .replace(/;/g, "\n")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const accounts = [];
  lines.forEach((line, idx) => {
    const acc = parseAccountLine(line, idx);
    if (acc) accounts.push(acc);
  });
  return accounts;
}

function firstEnv(keys) {
  for (const k of keys) {
    if (process.env[k] != null && String(process.env[k]).trim() !== "") {
      return { key: k, value: String(process.env[k]) };
    }
  }
  return null;
}

function resolveProxyApiUrl(jsonCfg = null) {
  const env = firstEnv([
    "QIEHUANG_PROXY_API",
    "QH_PROXY_API",
    "PROXY_API",
    "proxy_api",
  ]);
  if (env) return { key: env.key, url: env.value.trim() };

  if (jsonCfg) {
    const v = jsonCfg.proxyApi || jsonCfg.proxyApiUrl || jsonCfg.PROXY_API;
    if (v && String(v).trim()) {
      return { key: "accounts.json", url: String(v).trim() };
    }
  }
  return { key: "none", url: "" };
}

function loadConfig() {
  // 优先读取 QH 环境变量（新格式 wid#openId），兼容旧变量
  const envAcc = firstEnv([
    "QH",
    "qiehuang_ck",
    "QIEHUANG_CK",
  ]);

  let accounts = [];
  let source = "";
  let jsonCfg = null;

  if (envAcc) {
    accounts = parseAccountsFromText(envAcc.value);
    source = `环境变量 ${envAcc.key}`;
  }

  const jsonPath = path.join(__dirname, "accounts.json");
  if (fs.existsSync(jsonPath)) {
    try {
      jsonCfg = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
    } catch (_) {
      jsonCfg = null;
    }
  }

  if (!accounts.length && jsonCfg) {
    accounts = (jsonCfg.accounts || []).filter((a) => a.enabled !== false);
    source = "accounts.json";
  }

  const proxyResolved = resolveProxyApiUrl(jsonCfg);

  return {
    accounts,
    source: source || "无",
    proxyApiUrl: proxyResolved.url,
    proxySource: proxyResolved.key,
  };
}

async function main() {
  const cfg = loadConfig();
  const accounts = cfg.accounts || [];
  const logger = new RunLogger();

  if (!accounts.length) {
    const msg = "没有可用账号，请配置环境变量 QH\n格式：wid#openId\n多账号用 & 或换行分隔";
    console.log(msg);
    await sendNotify("统一茄皇五期", msg);
    return;
  }

  console.log(`统一茄皇五期`);
  console.log(`共 ${accounts.length} 个账号`);
  console.log(`代理：${cfg.proxyApiUrl ? "已配置" : "直连"}`);

  for (let i = 0; i < accounts.length; i++) {
    const acc = accounts[i];
    const wid = acc.wid || "无";
    logger.startAccount(i + 1, acc.name, wid, acc.openId);
    logger.log(`开始处理 ${acc.name}`);

    try {
      const client = new QiehuangClient(acc, {
        _index: i + 1,
        proxyApiUrl: cfg.proxyApiUrl,
      });

      const home = await client.runDaily(logger);

      if (home) {
        logger.log(`能量：${home.energyBalance || 0}，番茄：${home.tomatoBalance || 0}`);
        logger.log(`${home.stageName || "未知阶段"} ${home.currentExp || 0}/${home.stageRequiredExp || 0}`);
      }
      logger.endAccount(true);
    } catch (e) {
      logger.log(`处理失败：${e.message}`);
      logger.endAccount(false, e.message);
    }

    if (i < accounts.length - 1) {
      await humanDelay("account");
    }
  }

  // 生成并发送通知报告
  const report = logger.buildReport();
  console.log("\n" + report);
  await sendNotify("统一茄皇五期", report);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = {
  QiehuangClient,
  encryptRequestBody,
  buildMiniProgramFingerprint,
  parseAccountsFromText,
  loadConfig,
  humanDelay,
  fetchProxyFromApi,
  parseProxy,
  resolveProxyApiUrl,
  maskStr,
  RunLogger,
  retryWithBackoff,
};

