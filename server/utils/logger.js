function redactValue(key, value) {
  const normalizedKey = String(key || "").toLowerCase();
  if (["authorization", "cookie", "password", "password_hash", "token", "client_secret", "app_secret"].includes(normalizedKey)) {
    return "[redacted]";
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactValue(key, item));
  }

  if (value instanceof Error) {
    return serializeError(value);
  }

  if (value && typeof value === "object") {
    return Object.entries(value).reduce((acc, [childKey, childValue]) => {
      acc[childKey] = redactValue(childKey, childValue);
      return acc;
    }, {});
  }

  return value;
}

function serializeError(error) {
  if (!(error instanceof Error)) return error;
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
}

function buildPayload(level, bindings, meta, message) {
  const entry = {
    level,
    time: new Date().toISOString(),
    ...bindings,
  };

  if (typeof meta === "string" && message === undefined) {
    entry.message = meta;
    return redactValue("", entry);
  }

  if (message !== undefined) {
    entry.message = message;
  }

  if (meta instanceof Error) {
    entry.err = serializeError(meta);
  } else if (meta && typeof meta === "object") {
    Object.assign(entry, meta);
  } else if (meta !== undefined) {
    entry.meta = meta;
  }

  return redactValue("", entry);
}

function createLogger(bindings = {}) {
  const write = (level, meta, message) => {
    const payload = buildPayload(level, bindings, meta, message);
    const line = JSON.stringify(payload);

    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  };

  return {
    child(extraBindings = {}) {
      return createLogger({ ...bindings, ...extraBindings });
    },
    info(meta, message) {
      write("info", meta, message);
    },
    warn(meta, message) {
      write("warn", meta, message);
    },
    error(meta, message) {
      write("error", meta, message);
    },
  };
}

module.exports = createLogger();
