const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const MAX_BACKUP_OUTPUT_CHARS = 8000;
const BACKUP_TIMEOUT_MS = 10 * 60 * 1000;

function getBackupScriptPath() {
  const configured = String(process.env.BACKUP_SCRIPT_PATH || "").trim();
  if (!configured) {
    const error = new Error("BACKUP_SCRIPT_PATH is not configured");
    error.status = 503;
    throw error;
  }

  const resolved = path.resolve(configured);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    const error = new Error("BACKUP_SCRIPT_PATH does not point to an executable script");
    error.status = 500;
    throw error;
  }

  return resolved;
}

function appendOutput(current, next) {
  const combined = `${current}${next}`;
  return combined.length > MAX_BACKUP_OUTPUT_CHARS ? combined.slice(-MAX_BACKUP_OUTPUT_CHARS) : combined;
}

const runBackup = async (_req, res) => {
  try {
    const scriptPath = getBackupScriptPath();
    const startedAt = Date.now();
    let output = "";

    const child = spawn("bash", [scriptPath], {
      env: process.env,
      windowsHide: true,
    });

    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, BACKUP_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      output = appendOutput(output, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk) => {
      output = appendOutput(output, chunk.toString("utf8"));
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      res.status(500).json({ message: error.message, output });
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      const payload = {
        exit_code: code,
        duration_ms: Date.now() - startedAt,
        output,
      };
      if (code === 0) return res.json({ message: "Backup completed", ...payload });
      return res.status(500).json({ message: "Backup failed", ...payload });
    });
  } catch (err) {
    res.status(Number(err.status) || 500).json({ message: err.message });
  }
};

module.exports = {
  runBackup,
};
