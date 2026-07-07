const crypto = require("crypto");

const KEY = crypto.scryptSync(
  process.env.EMAIL_SECRET || "inventory-default-key",
  "inventory-salt-v1",
  32
);

function encrypt(text) {
  if (!text) return null;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = cipher.update(text, "utf8", "hex") + cipher.final("hex");
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${enc}`;
}

function decrypt(data) {
  if (!data) return null;
  try {
    const [ivHex, tagHex, enc] = data.split(":");
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(enc, "hex", "utf8") + decipher.final("utf8");
  } catch { return null; }
}

module.exports = { encrypt, decrypt };
