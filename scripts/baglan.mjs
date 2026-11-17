// Supabase bağlantı adresini .env.local dosyasına yazar.
//   ~/.local/node/bin/node scripts/baglan.mjs
// Adres Supabase > Connect > Transaction pooler'dan kopyalanır. İçinde [YOUR-PASSWORD] varsa parola ayrıca (gizli) sorulur.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const ENV = path.join(ROOT, ".env.local");

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(question, (a) => { rl.close(); res(a.trim()); }));
}

/** Yazılanı ekranda göstermeden bir satır okur. */
function askHidden(question) {
  return new Promise((res) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (chunk) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          stdin.setRawMode(false); stdin.pause(); stdin.off("data", onData);
          process.stdout.write("\n");
          return res(value);
        }
        if (ch === "\u0003") { process.stdout.write("\n"); process.exit(130); }
        if (ch === "\u007f" || ch === "\b") { value = value.slice(0, -1); continue; }
        value += ch;
      }
    };
    stdin.on("data", onData);
  });
}

console.log("\nFampani · Supabase bağlantısı\n");
let url = (await ask("1) Supabase'den kopyaladığın bağlantı adresini yapıştır ve Enter'a bas:\n> ")).replace(/^["']|["']$/g, "");

if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error("\nBu bir bağlantı adresi değil; 'postgresql://' ile başlamalı. Supabase > Connect penceresinden tekrar kopyala.");
  process.exit(1);
}

if (/\[YOUR-PASSWORD\]/i.test(url)) {
  const pw = await askHidden("2) Proje açarken belirlediğin veritabanı parolasını yaz (ekranda görünmez) ve Enter'a bas:\n> ");
  if (!pw) { console.error("\nParola boş olamaz."); process.exit(1); }
  url = url.replace(/\[YOUR-PASSWORD\]/i, encodeURIComponent(pw));
}

let parsed;
try { parsed = new URL(url); } catch { console.error("\nAdres çözümlenemedi; parolada özel karakter varsa adresi [YOUR-PASSWORD] haliyle yapıştırıp parolayı ayrıca yaz."); process.exit(1); }
if (!parsed.password) { console.error("\nAdreste parola yok."); process.exit(1); }
if (parsed.port !== "6543") console.log(`\nNot: port ${parsed.port || "(yok)"} — Supabase'de 'Transaction pooler' (port 6543) adresi önerilir. Yine de kaydediyorum.`);

let env = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8") : "";
env = env.split("\n").filter((l) => !/^\s*DATABASE_URL\s*=/.test(l)).join("\n").replace(/\n*$/, "\n");
env += `DATABASE_URL=${parsed.toString()}\n`;
fs.writeFileSync(ENV, env, { mode: 0o600 });

console.log(`\nKaydedildi: .env.local → sunucu ${parsed.hostname}:${parsed.port}`);
console.log("Bağlantı deneniyor…");
try {
  const { default: postgres } = await import("postgres");
  const sql = postgres(parsed.toString(), { prepare: false, max: 1, connect_timeout: 15 });
  const [{ v }] = await sql`select version() as v`;
  await sql.end();
  console.log("Bağlantı başarılı: " + v.split(",")[0]);
  console.log("\nTamam! Claude'a 'bağladım' yazabilirsin.\n");
} catch (e) {
  console.error("\nBağlantı kurulamadı: " + e.message);
  console.error("Parolayı ya da kopyaladığın adresi kontrol edip komutu tekrar çalıştır.\n");
  process.exitCode = 1;
}
