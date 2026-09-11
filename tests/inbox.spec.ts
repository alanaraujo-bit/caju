import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { mkdir } from "node:fs/promises";

test("atendimento completo com dados de teste isolados", async ({
  page,
}, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (!new URL(process.env.DATABASE_URL!).pathname.startsWith("/caju_e2e_"))
    throw new Error("E2E requires an isolated database");
  const limits = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await limits.connect();
  await limits.query("DELETE FROM rate_limits");
  await limits.end();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/criar-conta");
  await page.getByLabel("Seu nome", { exact: true }).fill("Ana Oliveira");
  await page
    .getByLabel("Nome da empresa")
    .fill("Validação local · dados de teste");
  await page
    .getByLabel("E-mail", { exact: true })
    .fill(`inbox-${randomUUID()}@example.test`);
  await page
    .getByLabel("Senha", { exact: true })
    .fill("Senha exclusiva do teste 2026!");
  await page.getByRole("button", { name: "Criar minha empresa" }).click();
  await expect(page.getByRole("heading", { name: "Olá, Ana." })).toBeVisible();
  const session = await page.evaluate(() =>
    fetch("/api/auth/me").then((r) => r.json()),
  );
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const connectionId = randomUUID(),
    conversationId = randomUUID();
  try {
    await db.query("BEGIN");
    await db.query("SELECT set_config('caju.tenant_id',$1,true)", [
      session.user.tenantId,
    ]);
    await db.query(
      "INSERT INTO whatsapp_connections(id,tenant_id,label,status) VALUES($1,$2,'Conexão de teste sem transporte','attention')",
      [connectionId, session.user.tenantId],
    );
    await db.query(
      "INSERT INTO conversations(id,tenant_id,whatsapp_connection_id,remote_jid,title,protocol,last_message_at,last_message_preview,unread_count) VALUES($1,$2,$3,'5511999991111@s.whatsapp.net','Marina Santos · teste','CAJ-TESTE-001',now(),'Podemos confirmar o horário para amanhã?',1)",
      [conversationId, session.user.tenantId, connectionId],
    );
    await db.query(
      "INSERT INTO messages(id,tenant_id,conversation_id,whatsapp_connection_id,external_id,direction,kind,body,sender_name,sent_at) VALUES($1,$2,$3,$4,'test-message','inbound','text','Olá, Ana! Podemos confirmar o horário para amanhã?','Marina Santos',now())",
      [randomUUID(), session.user.tenantId, conversationId, connectionId],
    );
    await db.query(
      "INSERT INTO quick_replies(id,tenant_id,title,shortcut,body) VALUES($1,$2,'Confirmar horário','confirmar','Olá, Marina! Seu horário está confirmado para amanhã às 14h.')",
      [randomUUID(), session.user.tenantId],
    );
    await db.query("COMMIT");
  } finally {
    await db.end();
  }
  await page.goto("/inbox");
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: /Marina Santos/ }).click();
  await page.getByRole("button", { name: "Assumir atendimento" }).click();
  await expect(
    page.getByText("Você está cuidando deste atendimento"),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Respostas rápidas", exact: true })
    .click();
  await page.getByRole("button", { name: /Confirmar horário/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Mensagem", exact: true }),
  ).toHaveValue(/Seu horário está confirmado/);
  await page
    .getByRole("button", { name: "Enviar mensagem", exact: true })
    .click();
  await expect(page.getByText("Na fila", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Mensagem", exact: true }),
  ).toHaveValue("");
  await page.getByRole("button", { name: "Nota interna", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Nota interna", exact: true })
    .fill("Cliente prefere receber a confirmação no período da manhã.");
  await page
    .getByRole("button", { name: "Adicionar nota", exact: true })
    .click();
  await expect(page.getByText("Nota interna · Ana Oliveira")).toBeVisible();
  await page.getByRole("button", { name: "Responder", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Mensagem", exact: true })
    .fill("Rascunho que deve permanecer");
  await page.goto("/contatos");
  // SPA navigation is what preserves the in-memory draft; a document reload intentionally clears it.
  await page.goto("/inbox");
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: /Marina Santos/ }).click();
  await expect(page.getByText("Nota interna · Ana Oliveira")).toBeVisible();
  await mkdir(".impeccable/review", { recursive: true });
  for (const theme of ["claro", "escuro", "areia", "cafe"]) {
    await page.evaluate((value) => {
      document.documentElement.dataset.theme = value;
    }, theme);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
    ).toBe(false);
    await page.screenshot({
      path: `.impeccable/review/inbox-operational-${theme}-${info.project.name}.png`,
      fullPage: true,
    });
  }
  await page.getByLabel("Status do atendimento").selectOption("closed");
  await expect(
    page.getByRole("dialog", { name: "Finalizar atendimento" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Motivo da finalização" })
    .fill("Orientações fornecidas e horário confirmado.");
  await page.getByRole("button", { name: "Confirmar finalização" }).click();
  await expect(
    page.getByText("Atendimento finalizado", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Reabrir", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Enviar mensagem", exact: true }),
  ).toBeVisible();
  if (info.project.name === "mobile")
    await page.getByRole("button", { name: "Voltar para a lista" }).click();
  await page
    .getByRole("textbox", { name: "Buscar atendimentos" })
    .fill("período da manhã");
  await expect(
    page.getByRole("button", { name: /Marina Santos/ }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Buscar atendimentos" })
    .fill("Não existe");
  await expect(page.getByText("Nenhum atendimento encontrado")).toBeVisible();
  await page.getByRole("button", { name: "Limpar filtros" }).click();
  await expect(
    page.getByRole("button", { name: /Marina Santos/ }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
