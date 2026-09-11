import { execFileSync, spawnSync } from "node:child_process";
import {
  environment,
  project,
  railway,
  service,
  setVariable,
  variables,
} from "./railway-context.mjs";

// Publicação completa: a migration precisa chegar ao banco ANTES do código novo
// atender requisições. O comando de boot do serviço (railway.json) aplica as
// migrations quando MIGRATION_DATABASE_URL existe; este script coloca a
// credencial só durante a publicação e a remove assim que o deploy termina.
//
//   node scripts/release.mjs            publica API + web e faz o smoke test
//   node scripts/release.mjs --dry-run  mostra os passos sem tocar em nada
//   node scripts/release.mjs --api      só a API (Railway)
//   node scripts/release.mjs --web      só o front (Vercel)

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const doApi = !args.has("--web") || args.has("--api");
const doWeb = !args.has("--api") || args.has("--web");
const publicApi = "https://api-production-beeaa.up.railway.app";
const publicWeb = "https://caju-one.vercel.app";

const step = (title) => console.log(`\n▶ ${title}`);
const win = process.platform === "win32";
const npm = win ? "npm.cmd" : "npm";
const run = (command, cliArgs) => {
  console.log(`  $ ${command} ${cliArgs.join(" ")}`);
  if (dryRun) return "";
  // .cmd só abre por shell no Node 24; os argumentos aqui são constantes do script.
  return execFileSync(command, cliArgs, {
    encoding: "utf8",
    stdio: "inherit",
    shell: command.endsWith(".cmd"),
  });
};
// Depois da publicação a variável fica com um valor que migrate.js reconhece como
// "nada a aplicar": a credencial do dono do banco não permanece no serviço.
const unsetMarker = "esvaziada-apos-publicacao";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function health(url, attempts = 20) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(8000) });
      const body = await response.json().catch(() => ({}));
      if (response.ok && body.status === "ok") return true;
    } catch {}
    await sleep(3000);
  }
  return false;
}

step("Verificação local (typecheck + build)");
run(npm, ["run", "typecheck"]);
run(npm, ["run", "build"]);
const dirty = execFileSync("git", ["status", "--porcelain"], {
  encoding: "utf8",
}).trim();
if (dirty)
  console.warn(
    "  Atenção: há alterações não commitadas; o Railway publica o diretório como está.",
  );

if (doApi) {
  step("API: credencial de migration só durante a publicação");
  const migrationUrl = dryRun
    ? "<DATABASE_URL do serviço Postgres>"
    : variables("Postgres").DATABASE_URL;
  if (!migrationUrl) throw new Error("DATABASE_URL do Postgres não encontrada");
  console.log(
    "  railway variable set MIGRATION_DATABASE_URL --stdin --skip-deploys (valor mascarado)",
  );
  if (!dryRun) setVariable("MIGRATION_DATABASE_URL", migrationUrl);
  let deployed = false;
  try {
    step(
      "API: railway up (a migration roda no boot, antes do servidor aceitar tráfego)",
    );
    console.log("  $ railway up --service api --detach");
    if (!dryRun)
      console.log(
        railway([
          "up",
          "--service",
          service,
          "--environment",
          environment,
          "--project",
          project,
          "--detach",
        ]),
      );
    step("API: aguardando o deployment terminar");
    const started = Date.now();
    while (!dryRun) {
      const [latest] = JSON.parse(
        railway([
          "deployment",
          "list",
          "--service",
          service,
          "--environment",
          environment,
          "--project",
          project,
          "--limit",
          "1",
          "--json",
        ]),
      );
      const status = latest?.status ?? "UNKNOWN";
      console.log(`  ${new Date().toISOString().slice(11, 19)} ${status}`);
      if (status === "SUCCESS") {
        deployed = true;
        break;
      }
      if (["FAILED", "CRASHED", "REMOVED"].includes(status))
        throw new Error(
          `Deployment terminou como ${status}. Veja os logs: railway logs --service api`,
        );
      if (Date.now() - started > 15 * 60_000)
        throw new Error("Deployment não concluiu em 15 minutos.");
      await sleep(10_000);
    }
  } finally {
    // "variable delete" dispararia outro deploy; o marcador mantém o serviço sem a
    // credencial e um reinício futuro sobe sem tentar migrar.
    step("API: esvaziando MIGRATION_DATABASE_URL no serviço");
    console.log(
      `  railway variable set MIGRATION_DATABASE_URL --stdin --skip-deploys (${unsetMarker})`,
    );
    if (!dryRun) setVariable("MIGRATION_DATABASE_URL", unsetMarker);
  }
  if (!dryRun && deployed) {
    step("API: smoke test");
    if (!(await health(`${publicApi}/api/health`)))
      throw new Error(
        "A API publicada não respondeu status ok em /api/health.",
      );
    console.log("  /api/health ok");
  }
}

if (doWeb) {
  step("Web: vercel deploy --prod");
  const result = spawnSync(
    win ? "npx.cmd" : "npx",
    ["-y", "vercel@latest", "deploy", "--prod", "--yes"],
    { encoding: "utf8", stdio: dryRun ? "ignore" : "inherit" },
  );
  if (!dryRun && result.status !== 0) throw new Error("vercel deploy falhou.");
  if (!dryRun) {
    step("Web: smoke test pela mesma origem");
    if (!(await health(`${publicWeb}/api/health`)))
      throw new Error("O front publicado não alcançou a API em /api/health.");
    console.log(`  ${publicWeb}/api/health ok`);
  }
}

console.log(
  dryRun
    ? "\nDry-run concluído: nada foi alterado."
    : "\nPublicação concluída.",
);
