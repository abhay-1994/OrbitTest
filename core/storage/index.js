const fs = require("fs");
const path = require("path");

function createStorageApi(orbit) {
  const cookies = options => {
    return orbit.traceStep("storage.cookies", () => getCookies(orbit, options));
  };

  const setCookie = (cookieOrName, valueOrOptions, maybeOptions) => {
    const { cookie, options } = parseSetCookieArgs(cookieOrName, valueOrOptions, maybeOptions);

    return orbit.traceStep(`storage.setCookie ${cookie.name || ""}`.trim(), () => {
      return setOneCookie(orbit, cookie, options);
    });
  };

  const setCookies = (cookieList, options = {}) => {
    return orbit.traceStep("storage.setCookies", () => setManyCookies(orbit, cookieList, options));
  };

  const deleteCookie = (cookieOrName, options = {}) => {
    const cookie = typeof cookieOrName === "object" && cookieOrName
      ? { ...cookieOrName }
      : { name: cookieOrName };

    return orbit.traceStep(`storage.deleteCookie ${cookie.name || ""}`.trim(), () => {
      return deleteOneCookie(orbit, cookie, options);
    });
  };

  const clearCookies = options => {
    return orbit.traceStep("storage.clearCookies", () => clearAllCookies(orbit, options));
  };

  const local = options => {
    return orbit.traceStep("storage.local", () => readWebStorage(orbit, "local", options));
  };

  const getLocal = (name, options) => {
    return orbit.traceStep(`storage.getLocal ${name}`, () => getWebStorageItem(orbit, "local", name, options));
  };

  const setLocal = (name, value, options) => {
    return orbit.traceStep(`storage.setLocal ${name}`, () => setWebStorageItem(orbit, "local", name, value, options));
  };

  const removeLocal = (name, options) => {
    return orbit.traceStep(`storage.removeLocal ${name}`, () => removeWebStorageItem(orbit, "local", name, options));
  };

  const clearLocal = options => {
    return orbit.traceStep("storage.clearLocal", () => clearWebStorage(orbit, "local", options));
  };

  const session = options => {
    return orbit.traceStep("storage.session", () => readWebStorage(orbit, "session", options));
  };

  const getSession = (name, options) => {
    return orbit.traceStep(`storage.getSession ${name}`, () => getWebStorageItem(orbit, "session", name, options));
  };

  const setSession = (name, value, options) => {
    return orbit.traceStep(`storage.setSession ${name}`, () => setWebStorageItem(orbit, "session", name, value, options));
  };

  const removeSession = (name, options) => {
    return orbit.traceStep(`storage.removeSession ${name}`, () => removeWebStorageItem(orbit, "session", name, options));
  };

  const clearSession = options => {
    return orbit.traceStep("storage.clearSession", () => clearWebStorage(orbit, "session", options));
  };

  const saveSession = (filePath, options) => {
    return orbit.traceStep(`storage.saveSession ${filePath}`, () => saveSessionState(orbit, filePath, options));
  };

  const loadSession = (filePath, options) => {
    return orbit.traceStep(`storage.loadSession ${filePath}`, () => loadSessionState(orbit, filePath, options));
  };

  const clear = (options = {}) => {
    return orbit.traceStep("storage.clear", () => clearStorageState(orbit, options));
  };

  const inspect = (options = {}) => {
    return orbit.traceStep("storage.inspect", () => inspectStorageState(orbit, options));
  };

  const expectHealthySession = (options = {}) => {
    return orbit.traceStep("storage.expectHealthySession", () => assertHealthySession(orbit, options));
  };

  return {
    cookies,
    getCookies: cookies,
    setCookie,
    setCookies,
    deleteCookie,
    clearCookies,
    local,
    getLocal,
    setLocal,
    removeLocal,
    clearLocal,
    session,
    getSession,
    setSession,
    removeSession,
    clearSession,
    saveSession,
    loadSession,
    saveState: saveSession,
    loadState: loadSession,
    clear,
    inspect,
    health: inspect,
    expectHealthySession,
    expectSession: expectHealthySession
  };
}

async function getCookies(orbit, options = {}) {
  const source = normalizeOptions(options);
  const connection = orbit.requireConnection();
  const timeoutMs = normalizeTimeout(source, 5000);
  const urls = await resolveCookieUrls(orbit, source);

  if (!source.all && urls.length > 0) {
    const response = await connection.send("Network.getCookies", { urls }, { timeoutMs });
    return normalizeCookiesForUser(response.result?.cookies || []);
  }

  try {
    const response = await connection.send("Network.getAllCookies", {}, { timeoutMs });
    return normalizeCookiesForUser(response.result?.cookies || []);
  } catch (error) {
    const response = await connection.send("Network.getCookies", {}, { timeoutMs });
    return normalizeCookiesForUser(response.result?.cookies || []);
  }
}

async function setOneCookie(orbit, cookie, options = {}) {
  const source = normalizeOptions(options);
  const connection = orbit.requireConnection();
  const params = await normalizeCookieForSet(orbit, cookie, source);
  const response = await connection.send("Network.setCookie", params, {
    timeoutMs: normalizeTimeout(source, 5000)
  });

  if (response.result?.success === false) {
    throw new Error(`Chrome rejected cookie "${params.name}". Check url/domain/path/sameSite values.`);
  }

  return normalizeCookieForUser(params);
}

async function setManyCookies(orbit, cookieList, options = {}) {
  if (!Array.isArray(cookieList)) {
    throw new Error("storage.setCookies() expects an array of cookie objects.");
  }

  const saved = [];

  for (const cookie of cookieList) {
    saved.push(await setOneCookie(orbit, cookie, options));
  }

  return saved;
}

async function deleteOneCookie(orbit, cookie, options = {}) {
  const source = normalizeOptions(options);
  const connection = orbit.requireConnection();
  const params = await normalizeCookieForDelete(orbit, cookie, source);

  await connection.send("Network.deleteCookies", params, {
    timeoutMs: normalizeTimeout(source, 5000)
  });

  return {
    name: params.name,
    deleted: true
  };
}

async function clearAllCookies(orbit, options = {}) {
  const source = normalizeOptions(options);
  const connection = orbit.requireConnection();

  await connection.send("Network.clearBrowserCookies", {}, {
    timeoutMs: normalizeTimeout(source, 5000)
  });

  return {
    cleared: true
  };
}

async function readWebStorage(orbit, type, options = {}) {
  return orbit.evaluateOnPage(storageType => {
    const storage = storageType === "session" ? window.sessionStorage : window.localStorage;
    const values = {};

    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      values[key] = storage.getItem(key);
    }

    return values;
  }, [type], options);
}

async function getWebStorageItem(orbit, type, name, options = {}) {
  const key = normalizeStorageKey(name);

  return orbit.evaluateOnPage((storageType, itemKey) => {
    const storage = storageType === "session" ? window.sessionStorage : window.localStorage;
    return storage.getItem(itemKey);
  }, [type, key], options);
}

async function setWebStorageItem(orbit, type, name, value, options = {}) {
  const key = normalizeStorageKey(name);
  const storedValue = normalizeStorageValue(value);

  await orbit.evaluateOnPage((storageType, itemKey, itemValue) => {
    const storage = storageType === "session" ? window.sessionStorage : window.localStorage;
    storage.setItem(itemKey, itemValue);
  }, [type, key, storedValue], options);

  return {
    name: key,
    value: storedValue
  };
}

async function removeWebStorageItem(orbit, type, name, options = {}) {
  const key = normalizeStorageKey(name);

  await orbit.evaluateOnPage((storageType, itemKey) => {
    const storage = storageType === "session" ? window.sessionStorage : window.localStorage;
    storage.removeItem(itemKey);
  }, [type, key], options);

  return {
    name: key,
    removed: true
  };
}

async function clearWebStorage(orbit, type, options = {}) {
  await orbit.evaluateOnPage(storageType => {
    const storage = storageType === "session" ? window.sessionStorage : window.localStorage;
    storage.clear();
  }, [type], options);

  return {
    cleared: true
  };
}

async function saveSessionState(orbit, filePath, options = {}) {
  const outputPath = normalizeSessionPath(filePath);
  const source = normalizeOptions(options);
  const pageState = await readPageStateSafe(orbit);
  const origin = await getCurrentOriginSafe(orbit);
  const cookies = await getCookies(orbit, {
    ...source,
    all: Boolean(source.allCookies || source.all),
    url: source.url || source.urls || pageState.url
  });
  const origins = [];

  if (source.storage !== false && origin) {
    origins.push({
      origin,
      localStorage: objectToStoragePairs(await readWebStorage(orbit, "local", source)),
      sessionStorage: objectToStoragePairs(await readWebStorage(orbit, "session", source))
    });
  }

  const state = {
    version: 1,
    createdAt: new Date().toISOString(),
    url: pageState.url || "",
    title: pageState.title || "",
    cookies,
    origins
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  return {
    path: outputPath,
    ...state
  };
}

async function loadSessionState(orbit, filePath, options = {}) {
  const inputPath = normalizeSessionPath(filePath);
  const source = normalizeOptions(options);
  const state = readSessionState(inputPath);
  const cookies = Array.isArray(state.cookies) ? state.cookies : [];
  const origins = Array.isArray(state.origins) ? state.origins : [];
  const appliedCookies = await setManyCookies(orbit, cookies, {
    ...source,
    url: source.url || state.url
  });
  let currentOrigin = await getCurrentOriginSafe(orbit);

  if (!currentOrigin && source.openOrigin !== false && origins[0]?.origin) {
    await orbit.open(origins[0].origin);
    currentOrigin = await getCurrentOriginSafe(orbit);
  }

  const targetOrigin = normalizeOrigin(source.origin || currentOrigin);
  const appliedOrigins = [];

  if (source.storage !== false && targetOrigin) {
    for (const originState of origins) {
      if (normalizeOrigin(originState.origin) !== targetOrigin) {
        continue;
      }

      await applyStoragePairs(orbit, "local", originState.localStorage || [], source);
      await applyStoragePairs(orbit, "session", originState.sessionStorage || [], source);
      appliedOrigins.push(originState.origin);
    }
  }

  return {
    path: inputPath,
    cookies: appliedCookies.length,
    origins: appliedOrigins
  };
}

async function clearStorageState(orbit, options = {}) {
  const source = normalizeOptions(options);
  const includeCookies = source.cookies !== false;
  const includeLocal = source.local !== false && source.localStorage !== false;
  const includeSession = source.session !== false && source.sessionStorage !== false;
  const result = {};

  if (includeCookies) {
    result.cookies = await clearAllCookies(orbit, source);
  }

  if (includeLocal) {
    result.localStorage = await clearWebStorage(orbit, "local", source);
  }

  if (includeSession) {
    result.sessionStorage = await clearWebStorage(orbit, "session", source);
  }

  return result;
}

async function inspectStorageState(orbit, options = {}) {
  const source = normalizeOptions(options);
  const pageState = await readPageStateSafe(orbit);
  const origin = await getCurrentOriginSafe(orbit);
  const [cookies, localStorage, sessionStorage] = await Promise.all([
    getCookies(orbit, source),
    readWebStorage(orbit, "local", source),
    readWebStorage(orbit, "session", source)
  ]);
  const minMinutes = normalizeNonNegativeInteger(source.minMinutes ?? source.expiringSoonMinutes, 15);
  const nowMs = Date.now();
  const cookieSummary = summarizeCookies(cookies, {
    ...source,
    minMinutes,
    nowMs
  });
  const localSummary = summarizeStorageMap("localStorage", localStorage, {
    ...source,
    minMinutes,
    nowMs
  });
  const sessionSummary = summarizeStorageMap("sessionStorage", sessionStorage, {
    ...source,
    minMinutes,
    nowMs
  });
  const auth = summarizeAuthSignals([
    ...cookieSummary.authSignals,
    ...localSummary.authSignals,
    ...sessionSummary.authSignals
  ], {
    minMinutes,
    nowMs
  });

  return {
    version: 1,
    inspectedAt: new Date(nowMs).toISOString(),
    url: pageState.url || "",
    title: pageState.title || "",
    origin,
    privacy: {
      valuesRedacted: source.includeValues !== true,
      note: source.includeValues === true
        ? "Values are included because includeValues was enabled."
        : "Cookie and storage values are redacted by default."
    },
    cookies: cookieSummary.summary,
    localStorage: localSummary.summary,
    sessionStorage: sessionSummary.summary,
    auth,
    recommendations: buildStorageRecommendations({
      auth,
      cookies: cookieSummary.summary,
      localStorage: localSummary.summary,
      sessionStorage: sessionSummary.summary
    })
  };
}

async function assertHealthySession(orbit, options = {}) {
  const source = normalizeOptions(options);
  const minAuthSignals = normalizeNonNegativeInteger(source.minAuthSignals, 1);
  const allowExpiringSoon = Boolean(source.allowExpiringSoon);
  const inspection = await inspectStorageState(orbit, source);
  const problems = [];

  if (inspection.auth.signalCount < minAuthSignals) {
    problems.push(`expected at least ${minAuthSignals} auth signal(s), found ${inspection.auth.signalCount}`);
  }

  if (inspection.auth.expiredCount > 0) {
    problems.push(`${inspection.auth.expiredCount} auth signal(s) already expired`);
  }

  if (!allowExpiringSoon && inspection.auth.expiringSoonCount > 0) {
    problems.push(`${inspection.auth.expiringSoonCount} auth signal(s) expire within ${inspection.auth.minMinutes} minute(s)`);
  }

  if (source.requireCookie && inspection.cookies.authLikeCount < 1) {
    problems.push("expected an auth-like cookie");
  }

  if (source.requireLocalStorage && inspection.localStorage.authLikeCount < 1) {
    problems.push("expected an auth-like localStorage value");
  }

  if (source.requireSessionStorage && inspection.sessionStorage.authLikeCount < 1) {
    problems.push("expected an auth-like sessionStorage value");
  }

  if (problems.length > 0) {
    throw new Error(`Storage session is not healthy: ${problems.join("; ")}.`);
  }

  return inspection;
}

async function applyStoragePairs(orbit, type, pairs, options = {}) {
  if (!Array.isArray(pairs)) {
    return;
  }

  await clearWebStorage(orbit, type, options);

  for (const pair of pairs) {
    if (!pair || pair.name === undefined) {
      continue;
    }

    await setWebStorageItem(orbit, type, pair.name, pair.value ?? "", options);
  }
}

function summarizeCookies(cookies, options = {}) {
  const items = cookies.map(cookie => describeCookie(cookie, options));
  const authSignals = items.filter(item => item.authLike).map(item => item.authSignal);

  return {
    summary: {
      count: items.length,
      names: items.map(item => item.name).sort(),
      httpOnlyCount: items.filter(item => item.httpOnly).length,
      secureCount: items.filter(item => item.secure).length,
      sessionCount: items.filter(item => item.session).length,
      persistentCount: items.filter(item => !item.session).length,
      authLikeCount: authSignals.length,
      expiredCount: authSignals.filter(item => item.expired).length,
      expiringSoonCount: authSignals.filter(item => item.expiringSoon).length,
      items: items.map(({ authSignal, ...item }) => item)
    },
    authSignals
  };
}

function describeCookie(cookie = {}, options = {}) {
  const jwt = decodeJwtFromValue(cookie.value);
  const expiresAt = jwt?.expiresAt || cookieExpiresAt(cookie.expires);
  const authLike = isAuthLikeName(cookie.name) || Boolean(jwt);
  const expiry = describeExpiry(expiresAt, options);
  const item = compactObject({
    type: "cookie",
    name: cookie.name,
    domain: cookie.domain,
    path: cookie.path,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    session: cookie.session,
    sameSite: cookie.sameSite,
    priority: cookie.priority,
    value: options.includeValues === true ? cookie.value : undefined,
    preview: options.includeValues === true ? undefined : redactValue(cookie.value),
    valueLength: valueLength(cookie.value),
    authLike,
    jwt: jwt ? compactObject({
      expiresAt: jwt.expiresAt,
      subject: jwt.payload?.sub,
      issuer: jwt.payload?.iss
    }) : undefined,
    expiresAt,
    expired: expiry.expired,
    expiringSoon: expiry.expiringSoon,
    expiresInMs: expiry.expiresInMs
  });

  return {
    ...item,
    authSignal: {
      source: "cookie",
      name: cookie.name,
      expiresAt,
      expired: expiry.expired,
      expiringSoon: expiry.expiringSoon,
      expiresInMs: expiry.expiresInMs,
      httpOnly: cookie.httpOnly,
      secure: cookie.secure,
      jwt: Boolean(jwt)
    }
  };
}

function summarizeStorageMap(type, values = {}, options = {}) {
  const items = Object.keys(values)
    .sort()
    .map(name => describeStorageItem(type, name, values[name], options));
  const authSignals = items.filter(item => item.authLike).map(item => item.authSignal);

  return {
    summary: {
      count: items.length,
      keys: items.map(item => item.name),
      authLikeCount: authSignals.length,
      expiredCount: authSignals.filter(item => item.expired).length,
      expiringSoonCount: authSignals.filter(item => item.expiringSoon).length,
      items: items.map(({ authSignal, ...item }) => item)
    },
    authSignals
  };
}

function describeStorageItem(type, name, value, options = {}) {
  const jwt = decodeJwtFromValue(value);
  const expiresAt = jwt?.expiresAt || null;
  const authLike = isAuthLikeName(name) || Boolean(jwt);
  const expiry = describeExpiry(expiresAt, options);
  const item = compactObject({
    type,
    name,
    value: options.includeValues === true ? value : undefined,
    preview: options.includeValues === true ? undefined : redactValue(value),
    valueLength: valueLength(value),
    authLike,
    jwt: jwt ? compactObject({
      expiresAt: jwt.expiresAt,
      subject: jwt.payload?.sub,
      issuer: jwt.payload?.iss
    }) : undefined,
    expiresAt,
    expired: expiry.expired,
    expiringSoon: expiry.expiringSoon,
    expiresInMs: expiry.expiresInMs
  });

  return {
    ...item,
    authSignal: {
      source: type,
      name,
      expiresAt,
      expired: expiry.expired,
      expiringSoon: expiry.expiringSoon,
      expiresInMs: expiry.expiresInMs,
      jwt: Boolean(jwt)
    }
  };
}

function summarizeAuthSignals(signals, options = {}) {
  const authSignals = signals.filter(Boolean);
  const expiringSignals = authSignals.filter(signal => signal.expiresAt);
  const nextExpiry = expiringSignals
    .map(signal => signal.expiresAt)
    .sort()[0] || null;
  const nextExpiryMs = nextExpiry ? Date.parse(nextExpiry) - options.nowMs : null;

  return {
    present: authSignals.length > 0,
    signalCount: authSignals.length,
    expiredCount: authSignals.filter(signal => signal.expired).length,
    expiringSoonCount: authSignals.filter(signal => signal.expiringSoon).length,
    minMinutes: options.minMinutes,
    nextExpiry,
    nextExpiryMs,
    sources: authSignals.map(signal => compactObject({
      source: signal.source,
      name: signal.name,
      expiresAt: signal.expiresAt,
      expired: signal.expired,
      expiringSoon: signal.expiringSoon,
      httpOnly: signal.httpOnly,
      secure: signal.secure,
      jwt: signal.jwt
    }))
  };
}

function buildStorageRecommendations(details) {
  const recommendations = [];

  if (!details.auth.present) {
    recommendations.push("No auth-like cookies or storage keys were detected. Save or load a session before opening protected pages.");
  }

  if (details.auth.expiredCount > 0) {
    recommendations.push("At least one auth signal is expired. Recreate the saved session.");
  }

  if (details.auth.expiringSoonCount > 0) {
    recommendations.push("At least one auth signal expires soon. Refresh the session before running a long suite.");
  }

  if (details.cookies.authLikeCount > 0 && details.cookies.secureCount === 0) {
    recommendations.push("Auth-like cookies are present without secure cookies. Use secure cookies on HTTPS apps.");
  }

  if (details.localStorage.authLikeCount > 0) {
    recommendations.push("Auth data was found in localStorage. Keep saved session files out of source control.");
  }

  return recommendations;
}

function isAuthLikeName(name) {
  return /(auth|session|token|jwt|bearer|access|refresh|id_token|remember|sid|xsrf|csrf)/i.test(String(name || ""));
}

function redactValue(value) {
  if (value === undefined || value === null) {
    return "<empty>";
  }

  return `<redacted:${String(value).length}>`;
}

function valueLength(value) {
  return value === undefined || value === null ? 0 : String(value).length;
}

function cookieExpiresAt(value) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return new Date(number * 1000).toISOString();
}

function describeExpiry(expiresAt, options = {}) {
  if (!expiresAt) {
    return {
      expired: false,
      expiringSoon: false,
      expiresInMs: null
    };
  }

  const expiresMs = Date.parse(expiresAt);

  if (!Number.isFinite(expiresMs)) {
    return {
      expired: false,
      expiringSoon: false,
      expiresInMs: null
    };
  }

  const expiresInMs = expiresMs - options.nowMs;
  const windowMs = normalizeNonNegativeInteger(options.minMinutes, 15) * 60 * 1000;

  return {
    expired: expiresInMs <= 0,
    expiringSoon: expiresInMs > 0 && expiresInMs <= windowMs,
    expiresInMs
  };
}

function decodeJwtFromValue(value) {
  const text = String(value || "");
  const match = text.match(/eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);

  if (!match) {
    return null;
  }

  const token = match[0];
  const parts = token.split(".");

  if (parts.length < 2) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(base64UrlToBase64(parts[1]), "base64").toString("utf8"));
    const exp = Number(payload.exp);

    return {
      payload,
      expiresAt: Number.isFinite(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : null
    };
  } catch (error) {
    return null;
  }
}

function base64UrlToBase64(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));

  return `${normalized}${padding}`;
}

async function normalizeCookieForSet(orbit, cookie, options = {}) {
  if (!cookie || typeof cookie !== "object") {
    throw new Error("storage.setCookie() expects a cookie object or name/value pair.");
  }

  const name = normalizeCookieName(cookie.name);
  const params = {
    name,
    value: cookie.value === undefined ? "" : String(cookie.value)
  };
  const url = cookie.url ?? options.url;
  const domain = cookie.domain ?? options.domain;
  const pathValue = cookie.path ?? options.path;

  if (url !== undefined) {
    params.url = normalizeCookieUrl(url);
  } else if (domain !== undefined) {
    params.domain = String(domain);
  } else {
    const currentUrl = await getCurrentHttpUrl(orbit);
    if (!currentUrl) {
      throw new Error(`Cookie "${name}" needs a url or domain. Open an http/https page first or pass { url }.`);
    }
    params.url = currentUrl;
  }

  if (pathValue !== undefined) {
    params.path = String(pathValue || "/");
  } else if (params.domain) {
    params.path = "/";
  }

  if (cookie.secure !== undefined || options.secure !== undefined) {
    params.secure = Boolean(cookie.secure ?? options.secure);
  }

  if (cookie.httpOnly !== undefined || options.httpOnly !== undefined) {
    params.httpOnly = Boolean(cookie.httpOnly ?? options.httpOnly);
  }

  const sameSite = normalizeSameSite(cookie.sameSite ?? options.sameSite);
  if (sameSite) {
    params.sameSite = sameSite;
  }

  const priority = normalizePriority(cookie.priority ?? options.priority);
  if (priority) {
    params.priority = priority;
  }

  const expires = normalizeCookieExpires(cookie.expires ?? cookie.expiry ?? options.expires ?? options.expiry);
  if (expires !== null) {
    params.expires = expires;
  }

  return compactObject(params);
}

async function normalizeCookieForDelete(orbit, cookie, options = {}) {
  const name = normalizeCookieName(cookie.name);
  const params = { name };
  const url = cookie.url ?? options.url;
  const domain = cookie.domain ?? options.domain;
  const pathValue = cookie.path ?? options.path;

  if (url !== undefined) {
    params.url = normalizeCookieUrl(url);
  } else if (domain !== undefined) {
    params.domain = String(domain);
    if (pathValue !== undefined) {
      params.path = String(pathValue || "/");
    }
  } else {
    const currentUrl = await getCurrentHttpUrl(orbit);
    if (!currentUrl) {
      throw new Error(`Cookie "${name}" needs a url or domain to be deleted.`);
    }
    params.url = currentUrl;
  }

  return compactObject(params);
}

async function resolveCookieUrls(orbit, options = {}) {
  const rawUrls = [];

  if (Array.isArray(options.urls)) {
    rawUrls.push(...options.urls);
  } else if (options.urls !== undefined) {
    rawUrls.push(options.urls);
  }

  if (options.url !== undefined) {
    rawUrls.push(options.url);
  }

  if (rawUrls.length === 0 && !options.all) {
    const currentUrl = await getCurrentHttpUrl(orbit);
    if (currentUrl) {
      rawUrls.push(currentUrl);
    }
  }

  return rawUrls.map(value => {
    try {
      return normalizeCookieUrl(value);
    } catch (error) {
      return null;
    }
  }).filter(Boolean);
}

async function getCurrentHttpUrl(orbit) {
  const pageState = await readPageStateSafe(orbit);
  const url = pageState.url || "";

  return isHttpUrl(url) ? url : "";
}

async function getCurrentOriginSafe(orbit) {
  try {
    const origin = await orbit.getCurrentOrigin();
    return normalizeOrigin(origin);
  } catch (error) {
    return "";
  }
}

async function readPageStateSafe(orbit) {
  try {
    return await orbit.readPageState({ timeout: 1000 });
  } catch (error) {
    return {
      url: "",
      title: ""
    };
  }
}

function parseSetCookieArgs(cookieOrName, valueOrOptions, maybeOptions) {
  if (cookieOrName && typeof cookieOrName === "object" && !Array.isArray(cookieOrName)) {
    return {
      cookie: { ...cookieOrName },
      options: normalizeOptions(valueOrOptions)
    };
  }

  if (cookieOrName === undefined || cookieOrName === null || cookieOrName === "") {
    throw new Error("storage.setCookie() requires a cookie name.");
  }

  if (valueOrOptions === undefined) {
    throw new Error("storage.setCookie(name, value) requires a value.");
  }

  return {
    cookie: {
      name: cookieOrName,
      value: valueOrOptions
    },
    options: normalizeOptions(maybeOptions)
  };
}

function readSessionState(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Session file does not exist: ${filePath}`);
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Session file is invalid: ${filePath}`);
  }

  return parsed;
}

function normalizeSessionPath(filePath) {
  if (!filePath || typeof filePath !== "string") {
    throw new Error("Session file path must be a string.");
  }

  return path.resolve(filePath);
}

function normalizeCookieName(name) {
  const value = String(name ?? "").trim();

  if (!value) {
    throw new Error("Cookie name cannot be empty.");
  }

  return value;
}

function normalizeStorageKey(name) {
  const value = String(name ?? "");

  if (!value) {
    throw new Error("Storage key cannot be empty.");
  }

  return value;
}

function normalizeStorageValue(value) {
  return value === undefined || value === null ? "" : String(value);
}

function normalizeCookieUrl(value) {
  const url = String(value || "");

  if (!isHttpUrl(url)) {
    throw new Error(`Cookie url must use http or https: ${url}`);
  }

  return url;
}

function normalizeOrigin(value) {
  const raw = String(value || "");

  if (!raw || raw === "null") {
    return "";
  }

  try {
    return new URL(raw).origin;
  } catch (error) {
    return raw;
  }
}

function isHttpUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "http:" || url.protocol === "https:";
  } catch (error) {
    return false;
  }
}

function normalizeCookieExpires(value) {
  if (value === undefined || value === null || value === "" || value === -1) {
    return null;
  }

  if (value instanceof Date) {
    return Math.floor(value.getTime() / 1000);
  }

  if (typeof value === "number") {
    return value;
  }

  const parsed = Date.parse(String(value));

  if (!Number.isFinite(parsed)) {
    throw new Error(`Cookie expires value is invalid: ${value}`);
  }

  return Math.floor(parsed / 1000);
}

function normalizeSameSite(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const text = String(value).toLowerCase();
  if (text === "strict") return "Strict";
  if (text === "lax") return "Lax";
  if (text === "none" || text === "no_restriction" || text === "no-restriction") return "None";

  throw new Error(`Unsupported sameSite value: ${value}`);
}

function normalizePriority(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }

  const text = String(value).toLowerCase();
  if (text === "low") return "Low";
  if (text === "medium") return "Medium";
  if (text === "high") return "High";

  throw new Error(`Unsupported cookie priority value: ${value}`);
}

function normalizeCookiesForUser(cookies) {
  return cookies.map(normalizeCookieForUser);
}

function normalizeCookieForUser(cookie = {}) {
  return compactObject({
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    expires: cookie.expires,
    size: cookie.size,
    httpOnly: cookie.httpOnly,
    secure: cookie.secure,
    session: cookie.session,
    sameSite: cookie.sameSite,
    priority: cookie.priority,
    sameParty: cookie.sameParty,
    sourceScheme: cookie.sourceScheme,
    sourcePort: cookie.sourcePort
  });
}

function objectToStoragePairs(values = {}) {
  return Object.keys(values)
    .sort()
    .map(name => ({
      name,
      value: values[name]
    }));
}

function normalizeOptions(options = {}) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    return {};
  }

  return options;
}

function normalizeTimeout(options = {}, fallback = 5000) {
  if (typeof options === "number" || typeof options === "string") {
    return normalizeNonNegativeInteger(options, fallback);
  }

  if (!options || typeof options !== "object") {
    return fallback;
  }

  return normalizeNonNegativeInteger(options.timeout ?? options.timeoutMs, fallback);
}

function normalizeNonNegativeInteger(value, fallback) {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.floor(number);
}

function compactObject(value) {
  const result = {};

  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && item !== null) {
      result[key] = item;
    }
  }

  return result;
}

module.exports = {
  createStorageApi
};
